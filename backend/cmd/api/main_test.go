package main

import (
	"encoding/json"
	"io"
	"testing"
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
