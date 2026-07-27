package handler

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/vppillai/passbook/backend/internal/model"
)

// TestErrorResponses_AreJSON pins that error responses declare the content
// type they actually carry.
//
// Every error body in this package is JSON, and route() sets
// Content-Type: application/json up front — but http.Error overwrites that
// header with text/plain and appends a newline. Any consumer that dispatches
// on Content-Type (a proxy, a future non-browser client, anything doing
// resp.headers.get('content-type').includes('json')) is told the wrong thing.
// The app's own fetch wrapper survives only because it reads the body as text
// and JSON.parses it regardless of the header.
func TestErrorResponses_AreJSON(t *testing.T) {
	rt, repo := newTestRouter(t)
	token := seedSession(repo)

	cases := []struct {
		name       string
		method     string
		path       string
		opts       reqOpts
		wantStatus int
	}{
		{
			name: "403 origin gate", method: http.MethodGet, path: "/api/balance",
			opts: reqOpts{origin: "https://evil.example"}, wantStatus: http.StatusForbidden,
		},
		{
			name: "401 missing session", method: http.MethodGet, path: "/api/balance",
			opts: reqOpts{origin: testOrigin}, wantStatus: http.StatusUnauthorized,
		},
		{
			name: "404 unknown route", method: http.MethodGet, path: "/api/nope",
			opts: reqOpts{origin: testOrigin, token: token}, wantStatus: http.StatusNotFound,
		},
		{
			name: "400 bad month", method: http.MethodGet, path: "/api/month/not-a-month",
			opts: reqOpts{origin: testOrigin, token: token}, wantStatus: http.StatusBadRequest,
		},
		{
			name: "400 malformed body", method: http.MethodPost, path: "/api/expense",
			opts:       reqOpts{origin: testOrigin, token: token, body: "{not json"},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "400 bad expense id", method: http.MethodDelete, path: "/api/expense/2026-02/NOTANEXPENSE",
			opts: reqOpts{origin: testOrigin, token: token}, wantStatus: http.StatusBadRequest,
		},
		{
			name: "404 missing month for funds", method: http.MethodPost, path: "/api/month/2030-01/funds",
			opts:       reqOpts{origin: testOrigin, token: token, body: `{"amount":5}`},
			wantStatus: http.StatusNotFound,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := do(t, rt, tc.method, tc.path, tc.opts)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d (body %q)", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
				t.Errorf("Content-Type = %q, want application/json", ct)
			}
			if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
				t.Errorf("X-Content-Type-Options = %q, want nosniff", got)
			}

			var body struct {
				Error string `json:"error"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("body is not valid JSON (%v): %q", err, rec.Body.String())
			}
			if body.Error == "" {
				t.Errorf("error field is empty: %q", rec.Body.String())
			}
		})
	}
}

// An over-cap funds top-up is user error, not a server fault. AddFunds
// returns ErrInvalidAmount for it (ErrFundsNotPositive covers only <= 0), so
// without an explicit case it fell through to a 500.
func TestAddFunds_OverCapIsBadRequest(t *testing.T) {
	rt, repo := newTestRouter(t)
	token := seedSession(repo)
	repo.Months["2026-02"] = &model.MonthSummary{
		Month: "2026-02", AllowanceAdded: 100, EndingBalance: 100,
	}
	repo.MonthList["2026-02"] = repo.Months["2026-02"]

	rec := do(t, rt, http.MethodPost, "/api/month/2026-02/funds", reqOpts{
		origin: testOrigin, token: token, body: `{"amount":1000000}`,
	})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 (body %q)", rec.Code, rec.Body.String())
	}
	if got := repo.Months["2026-02"].AllowanceAdded; got != 100 {
		t.Errorf("AllowanceAdded = %v, want 100 (nothing should have been credited)", got)
	}
}
