package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

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

	// A single-case select would BLOCK if More() hung — which is the very
	// regression this test exists to catch, so the failure mode was a silent
	// stall until Go's package-level timeout panicked ten minutes later, with a
	// goroutine dump instead of a test name. The timeout turns that into a
	// named failure in a second.
	select {
	case more := <-done:
		if more {
			t.Errorf("More() = true, want false (no trailing data)")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Decode/More() hung on trailing data — the regression this test guards")
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

// TestConvertToHTTPRequest_DecodesRawPath is the B1 regression: APIGW
// HTTP API v2 delivers RawPath still percent-encoded, so the frontend's
// encodeURIComponent("EXP#...") arrives as "EXP%23...". convertToHTTPRequest
// must percent-decode it before assigning URL.Path, or the literal "%23"
// reaches the handler's EXP# prefix check and every expense PUT/DELETE 400s.
// This must NOT use httptest.NewRequest, which decodes paths itself and so
// would hide the bug.
func TestConvertToHTTPRequest_DecodesRawPath(t *testing.T) {
	event := events.APIGatewayV2HTTPRequest{
		RawPath: "/api/expense/2026-02/EXP%231234%23abcd",
		RequestContext: events.APIGatewayV2HTTPRequestContext{
			HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{
				Method:   "DELETE",
				SourceIP: "203.0.113.7",
			},
		},
	}

	req, err := convertToHTTPRequest(context.Background(), event)
	if err != nil {
		t.Fatalf("convertToHTTPRequest failed: %v", err)
	}
	want := "/api/expense/2026-02/EXP#1234#abcd"
	if req.URL.Path != want {
		t.Errorf("Path = %q, want %q (percent-encoded RawPath must be decoded)", req.URL.Path, want)
	}
}

// TestConvertToHTTPRequest_MalformedEscapeFallsBackToRaw pins the B1
// fallback: an un-decodable RawPath (dangling %) must not fail the request;
// the raw value is used as-is.
func TestConvertToHTTPRequest_MalformedEscapeFallsBackToRaw(t *testing.T) {
	event := events.APIGatewayV2HTTPRequest{
		RawPath: "/api/expense/2026-02/EXP%2",
		RequestContext: events.APIGatewayV2HTTPRequestContext{
			HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{Method: "GET"},
		},
	}
	req, err := convertToHTTPRequest(context.Background(), event)
	if err != nil {
		t.Fatalf("convertToHTTPRequest failed: %v", err)
	}
	if req.URL.Path != "/api/expense/2026-02/EXP%2" {
		t.Errorf("Path = %q, want the raw value (fallback on bad escaping)", req.URL.Path)
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

// TestConvertToHTTPRequest_DecodesBase64Body pins that a base64-encoded body is
// decoded before handlers see it.
//
// API Gateway sets IsBase64Encoded and base64s the payload whenever it decides
// the body is binary — which it does based on Content-Type, not on the actual
// content. A client posting perfectly good JSON under, say,
// application/octet-stream therefore delivered base64 text straight into
// json.Decoder, and the caller got an opaque "Invalid request body" 400 with no
// hint as to why. The flag was ignored entirely.
func TestConvertToHTTPRequest_DecodesBase64Body(t *testing.T) {
	const payload = `{"pin":"1234"}`
	event := events.APIGatewayV2HTTPRequest{
		RawPath:         "/api/auth/verify",
		Body:            base64.StdEncoding.EncodeToString([]byte(payload)),
		IsBase64Encoded: true,
		RequestContext: events.APIGatewayV2HTTPRequestContext{
			HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{
				Method: http.MethodPost, SourceIP: "203.0.113.1",
			},
		},
	}

	req, err := convertToHTTPRequest(context.Background(), event)
	if err != nil {
		t.Fatalf("convertToHTTPRequest: %v", err)
	}
	got, err := io.ReadAll(req.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if string(got) != payload {
		t.Errorf("body = %q, want %q", got, payload)
	}
}

// A plain (already-decoded) body must pass through untouched — the common case.
func TestConvertToHTTPRequest_PlainBodyUnchanged(t *testing.T) {
	const payload = `{"amount":5}`
	event := events.APIGatewayV2HTTPRequest{
		RawPath: "/api/expense",
		Body:    payload,
		RequestContext: events.APIGatewayV2HTTPRequestContext{
			HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{
				Method: http.MethodPost, SourceIP: "203.0.113.1",
			},
		},
	}
	req, err := convertToHTTPRequest(context.Background(), event)
	if err != nil {
		t.Fatalf("convertToHTTPRequest: %v", err)
	}
	got, _ := io.ReadAll(req.Body)
	if string(got) != payload {
		t.Errorf("body = %q, want %q", got, payload)
	}
}

// A body flagged as base64 but not actually decodable must not be silently
// handed on as-is in a way that hides the problem; the request should fail
// rather than produce a confusing downstream JSON error.
func TestConvertToHTTPRequest_InvalidBase64Errors(t *testing.T) {
	event := events.APIGatewayV2HTTPRequest{
		RawPath:         "/api/expense",
		Body:            "!!!not-base64!!!",
		IsBase64Encoded: true,
		RequestContext: events.APIGatewayV2HTTPRequestContext{
			HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{
				Method: http.MethodPost, SourceIP: "203.0.113.1",
			},
		},
	}
	if _, err := convertToHTTPRequest(context.Background(), event); err == nil {
		t.Error("expected an error for a body flagged base64 that does not decode")
	}
}

// handleRequest's status mapping had no coverage at all: every test in this
// file stopped at convertToHTTPRequest, and the previous attempt at this test
// only called the one-line decodedTooLarge comparator, never handleRequest, so
// nothing verified that the cap is applied to the DECODED length rather than
// the wire length.
//
// These reach handleRequest for real. They are able to because body validation
// now runs before router construction — so no TABLE_NAME, no AWS config and no
// DynamoDB client are needed to observe the mapping.
func TestHandleRequest_RejectsOversizedDecodedBody(t *testing.T) {
	// 40 KB of real content: over the 32 KB decoded cap, but under the 64 KB
	// wire pre-filter, so it can only be caught by the decoded check.
	raw := strings.Repeat("x", 40*1024)
	if len(raw) <= maxBodyBytes {
		t.Fatalf("fixture must exceed the decoded cap")
	}
	if len(raw) > 2*maxBodyBytes {
		t.Fatalf("fixture must stay under the wire pre-filter so the decoded check is what fires")
	}

	resp, err := handleRequest(context.Background(), events.APIGatewayV2HTTPRequest{
		RawPath: "/api/expense",
		Body:    raw,
		RequestContext: events.APIGatewayV2HTTPRequestContext{
			HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{
				Method: http.MethodPost, SourceIP: "203.0.113.1",
			},
		},
	})
	if err != nil {
		t.Fatalf("handleRequest: %v", err)
	}
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d, want 413", resp.StatusCode)
	}
}

// A body that is over the cap once base64 is EXPANDED but under it decoded must
// be accepted, not rejected. Measuring the encoded length turned a ~24 KB
// payload into a false 413.
func TestHandleRequest_AcceptsBodyOversizedOnlyWhenEncoded(t *testing.T) {
	raw := strings.Repeat("y", 26*1024) // 26 KB decoded -> ~35 KB encoded
	encoded := base64.StdEncoding.EncodeToString([]byte(raw))
	if len(encoded) <= maxBodyBytes {
		t.Fatalf("fixture must exceed the cap once encoded (%d)", len(encoded))
	}
	if len(raw) > maxBodyBytes {
		t.Fatalf("fixture must be under the cap decoded (%d)", len(raw))
	}

	resp, err := handleRequest(context.Background(), events.APIGatewayV2HTTPRequest{
		RawPath:         "/api/expense",
		Body:            encoded,
		IsBase64Encoded: true,
		RequestContext: events.APIGatewayV2HTTPRequestContext{
			HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{
				Method: http.MethodPost, SourceIP: "203.0.113.1",
			},
		},
	})
	if err != nil {
		t.Fatalf("handleRequest: %v", err)
	}
	if resp.StatusCode == http.StatusRequestEntityTooLarge {
		t.Errorf("status = 413 for a body that is only oversized when encoded; "+
			"the cap must measure decoded bytes (decoded=%d, encoded=%d, cap=%d)",
			len(raw), len(encoded), maxBodyBytes)
	}
}

// A body flagged base64 that does not decode is the caller's fault: 400, not
// the 500 that "failed to process request" would imply.
func TestHandleRequest_InvalidBase64Is400(t *testing.T) {
	resp, err := handleRequest(context.Background(), events.APIGatewayV2HTTPRequest{
		RawPath:         "/api/expense",
		Body:            "!!!not-base64!!!",
		IsBase64Encoded: true,
		RequestContext: events.APIGatewayV2HTTPRequestContext{
			HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{
				Method: http.MethodPost, SourceIP: "203.0.113.1",
			},
		},
	})
	if err != nil {
		t.Fatalf("handleRequest: %v", err)
	}
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
	if ct := resp.Headers["Content-Type"]; ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
}

// The wire pre-filter still fires for something genuinely enormous, without
// attempting to decode it.
func TestHandleRequest_RejectsOversizedWireBody(t *testing.T) {
	resp, err := handleRequest(context.Background(), events.APIGatewayV2HTTPRequest{
		RawPath: "/api/expense",
		Body:    strings.Repeat("z", 2*maxBodyBytes+1),
		RequestContext: events.APIGatewayV2HTTPRequestContext{
			HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{
				Method: http.MethodPost, SourceIP: "203.0.113.1",
			},
		},
	})
	if err != nil {
		t.Fatalf("handleRequest: %v", err)
	}
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d, want 413", resp.StatusCode)
	}
}
