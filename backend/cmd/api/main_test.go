package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

// TestBodyReader_EOF asserts the io.Reader contract: once all data has
// been read, the next Read must return io.EOF — not (0, nil).
//
// Regression guard. Pre-fix, this method returned (0, nil) at end-of-
// data. json.Decoder.Decode() tolerated it, but json.Decoder.More() —
// used by the decodeStrict helper added in PR-6 to reject trailing
// tokens — calls refill() in a loop that only exits on a non-nil err.
// Returning (0, nil) made refill() spin until the Lambda 10s timeout.
func TestBodyReader_EOF(t *testing.T) {
	body := &bodyReader{data: []byte(`{"pin":"1234"}`)}

	// Drain the body.
	buf := make([]byte, 64)
	n, err := body.Read(buf)
	if err != nil {
		t.Fatalf("first Read: unexpected error %v", err)
	}
	if n == 0 {
		t.Fatalf("first Read: got 0 bytes, want body length")
	}

	// Subsequent reads at EOF must return io.EOF.
	n, err = body.Read(buf)
	if n != 0 {
		t.Errorf("post-EOF Read: got %d bytes, want 0", n)
	}
	if err != io.EOF {
		t.Errorf("post-EOF Read: got err=%v, want io.EOF", err)
	}
}

// TestBodyReader_DecodeAndMore is the end-to-end shape of the hang:
// decode a JSON value, then call More() — without io.EOF this spins
// forever and the test would time out.
func TestBodyReader_DecodeAndMore(t *testing.T) {
	body := &bodyReader{data: []byte(`{"pin":"1234"}`)}

	dec := json.NewDecoder(body)
	dec.DisallowUnknownFields()

	var req struct {
		Pin string `json:"pin"`
	}
	if err := dec.Decode(&req); err != nil {
		t.Fatalf("Decode failed: %v", err)
	}
	if req.Pin != "1234" {
		t.Fatalf("Pin = %q, want 1234", req.Pin)
	}

	// This is the call that hung pre-fix. Now it must return false
	// promptly (no more JSON values after the first object).
	done := make(chan bool, 1)
	go func() { done <- dec.More() }()

	select {
	case more := <-done:
		if more {
			t.Errorf("More() = true, want false (no trailing data)")
		}
	}
}

// TestConvertToHTTPRequest pins the APIGW→net/http adaptation, most
// importantly the source-IP trust boundary: a client-supplied
// X-Source-Ip header must be overwritten by the API Gateway request
// context's SourceIP, or per-IP rate limiting becomes forgeable.
func TestConvertToHTTPRequest(t *testing.T) {
	event := events.APIGatewayV2HTTPRequest{
		RawPath:        "/api/month/2026-02",
		RawQueryString: "limit=5&cursor=abc",
		Headers: map[string]string{
			"x-session-token": "tok",
			"X-Source-Ip":     "6.6.6.6", // forged by the client
		},
		Body: `{"a":1}`,
		RequestContext: events.APIGatewayV2HTTPRequestContext{
			HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{
				Method:   "POST",
				SourceIP: "203.0.113.7",
			},
		},
	}

	req, err := convertToHTTPRequest(context.Background(), event)
	if err != nil {
		t.Fatalf("convertToHTTPRequest failed: %v", err)
	}
	if got := req.Header.Get("X-Source-Ip"); got != "203.0.113.7" {
		t.Errorf("X-Source-Ip = %q, want the APIGW value (forged header must be overwritten)", got)
	}
	if req.Method != "POST" {
		t.Errorf("Method = %q, want POST", req.Method)
	}
	if req.URL.Path != "/api/month/2026-02" {
		t.Errorf("Path = %q", req.URL.Path)
	}
	if req.URL.RawQuery != "limit=5&cursor=abc" {
		t.Errorf("RawQuery = %q", req.URL.RawQuery)
	}
	if got := req.Header.Get("X-Session-Token"); got != "tok" {
		t.Errorf("X-Session-Token = %q, want \"tok\"", got)
	}
	body, err := io.ReadAll(req.Body)
	if err != nil || string(body) != `{"a":1}` {
		t.Errorf("Body = %q (err %v), want the event body", body, err)
	}
}

// TestResponseWriter pins the http.ResponseWriter shim: implicit 200 on
// first Write, explicit status respected, and body accumulation.
func TestResponseWriter(t *testing.T) {
	t.Run("implicit 200", func(t *testing.T) {
		rw := &responseWriter{headers: make(http.Header)}
		if _, err := rw.Write([]byte("hello")); err != nil {
			t.Fatalf("Write failed: %v", err)
		}
		if rw.statusCode != http.StatusOK {
			t.Errorf("statusCode = %d, want 200", rw.statusCode)
		}
	})

	t.Run("explicit status and accumulated body", func(t *testing.T) {
		rw := &responseWriter{headers: make(http.Header)}
		rw.WriteHeader(http.StatusNotFound)
		rw.Write([]byte("not "))
		rw.Write([]byte("found"))
		if rw.statusCode != http.StatusNotFound {
			t.Errorf("statusCode = %d, want 404", rw.statusCode)
		}
		if rw.body != "not found" {
			t.Errorf("body = %q, want \"not found\"", rw.body)
		}
	})
}

// TestFlattenHeaders pins first-value-wins flattening and empty-slice
// skipping for the APIGW response header map.
func TestFlattenHeaders(t *testing.T) {
	h := http.Header{
		"Content-Type": {"application/json", "text/plain"},
		"X-Empty":      {},
	}
	flat := flattenHeaders(h)
	if flat["Content-Type"] != "application/json" {
		t.Errorf("Content-Type = %q, want first value", flat["Content-Type"])
	}
	if _, exists := flat["X-Empty"]; exists {
		t.Error("empty header slice must be skipped")
	}
}
