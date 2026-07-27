// Package httperr writes API error responses whose declared Content-Type
// matches the body they actually carry.
//
// It exists because net/http's Error helper hardcodes
// "text/plain; charset=utf-8". Every error body in this API is JSON, and the
// router sets Content-Type: application/json up front, but each http.Error
// call silently overwrote that — so the API told clients "text/plain" while
// handing them JSON. The app's own fetch wrapper only survived that because
// it reads the body as text and JSON.parses it regardless of the header.
//
// It lives in its own package because both handler and middleware need it,
// and middleware cannot import handler.
package httperr

import (
	"encoding/json"
	"net/http"

	"github.com/vppillai/passbook/backend/internal/model"
)

// WriteJSON emits {"error": message} with the given status.
//
// The message is marshaled rather than interpolated into a hand-written JSON
// string, so a quote or backslash in a future message cannot produce a
// malformed body. nosniff is set for parity with http.Error, which set it on
// every error response.
func WriteJSON(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(model.ErrorResponse{Error: message})
}
