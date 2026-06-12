package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/service"
	"github.com/vppillai/passbook/backend/internal/testutil"
)

const testOrigin = "https://app.example"

// newTestRouter builds a Router over the shared FakeRepo with a
// hard-stop, carry-over expense service ($100 allowance).
func newTestRouter(t *testing.T) (*Router, *testutil.FakeRepo) {
	t.Helper()
	repo := testutil.NewFakeRepo()
	authSvc := service.NewAuthService(repo)
	expSvc := service.NewExpenseService(repo, 100, false, true)
	return NewRouter(authSvc, expSvc, testOrigin), repo
}

// seedSession installs a session row directly (no Argon2) and returns
// the token. Protected-route tests should use this rather than the full
// setup→verify flow, which costs two Argon2 hashes each.
func seedSession(repo *testutil.FakeRepo) string {
	const tok = "test-session-token"
	repo.Sessions[tok] = &model.Session{Token: tok}
	return tok
}

type reqOpts struct {
	origin  string // "" omits the Origin header
	referer string
	token   string
	body    string
}

func do(t *testing.T, rt *Router, method, path string, o reqOpts) *httptest.ResponseRecorder {
	t.Helper()
	var body *strings.Reader
	if o.body != "" {
		body = strings.NewReader(o.body)
	} else {
		body = strings.NewReader("")
	}
	req := httptest.NewRequest(method, path, body)
	if o.origin != "" {
		req.Header.Set("Origin", o.origin)
	}
	if o.referer != "" {
		req.Header.Set("Referer", o.referer)
	}
	if o.token != "" {
		req.Header.Set("X-Session-Token", o.token)
	}
	rec := httptest.NewRecorder()
	rt.ServeHTTP(rec, req)
	return rec
}

// allowed is shorthand for "browser request from the real app".
var allowed = reqOpts{origin: testOrigin}

func authed(repo *testutil.FakeRepo, body string) reqOpts {
	return reqOpts{origin: testOrigin, token: seedSession(repo), body: body}
}

// =====================================================================
// Origin / Referer gate
// =====================================================================

func TestOriginGate(t *testing.T) {
	rt, _ := newTestRouter(t)

	t.Run("health is open without any origin", func(t *testing.T) {
		rec := do(t, rt, http.MethodGet, "/api/health", reqOpts{})
		if rec.Code != http.StatusOK {
			t.Errorf("health = %d, want 200", rec.Code)
		}
	})

	t.Run("no origin and no referer rejected", func(t *testing.T) {
		rec := do(t, rt, http.MethodGet, "/api/auth/status", reqOpts{})
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
	})

	t.Run("wrong origin rejected", func(t *testing.T) {
		rec := do(t, rt, http.MethodGet, "/api/auth/status", reqOpts{origin: "https://evil.example"})
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
	})

	t.Run("matching origin passes", func(t *testing.T) {
		rec := do(t, rt, http.MethodGet, "/api/auth/status", allowed)
		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", rec.Code)
		}
	})

	t.Run("matching referer prefix passes", func(t *testing.T) {
		rec := do(t, rt, http.MethodGet, "/api/auth/status", reqOpts{referer: testOrigin + "/passbook/kids/"})
		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", rec.Code)
		}
	})
}

// =====================================================================
// Auth middleware on protected routes
// =====================================================================

func TestProtectedRoutes(t *testing.T) {
	rt, repo := newTestRouter(t)

	t.Run("missing token", func(t *testing.T) {
		rec := do(t, rt, http.MethodGet, "/api/balance", allowed)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want 401", rec.Code)
		}
	})

	t.Run("invalid token", func(t *testing.T) {
		rec := do(t, rt, http.MethodGet, "/api/balance", reqOpts{origin: testOrigin, token: "bogus"})
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want 401", rec.Code)
		}
	})

	t.Run("valid token", func(t *testing.T) {
		rec := do(t, rt, http.MethodGet, "/api/balance", reqOpts{origin: testOrigin, token: seedSession(repo)})
		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", rec.Code)
		}
	})

	t.Run("unknown route 404", func(t *testing.T) {
		rec := do(t, rt, http.MethodGet, "/api/nope", reqOpts{origin: testOrigin, token: seedSession(repo)})
		if rec.Code != http.StatusNotFound {
			t.Errorf("status = %d, want 404", rec.Code)
		}
	})
}

// =====================================================================
// Auth endpoints: setup → verify → logout end-to-end (real Argon2 twice)
// =====================================================================

func TestAuthFlow(t *testing.T) {
	rt, repo := newTestRouter(t)

	// Setup
	rec := do(t, rt, http.MethodPost, "/api/auth/setup", reqOpts{origin: testOrigin, body: `{"pin":"1234"}`})
	if rec.Code != http.StatusOK {
		t.Fatalf("setup = %d, want 200 (body %s)", rec.Code, rec.Body)
	}
	if repo.Config == nil {
		t.Fatal("config not written by setup")
	}

	// Duplicate setup
	rec = do(t, rt, http.MethodPost, "/api/auth/setup", reqOpts{origin: testOrigin, body: `{"pin":"5678"}`})
	if rec.Code != http.StatusConflict {
		t.Errorf("duplicate setup = %d, want 409", rec.Code)
	}

	// Wrong PIN
	rec = do(t, rt, http.MethodPost, "/api/auth/verify", reqOpts{origin: testOrigin, body: `{"pin":"0000"}`})
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("wrong-pin verify = %d, want 401", rec.Code)
	}

	// Correct PIN
	rec = do(t, rt, http.MethodPost, "/api/auth/verify", reqOpts{origin: testOrigin, body: `{"pin":"1234"}`})
	if rec.Code != http.StatusOK {
		t.Fatalf("verify = %d, want 200 (body %s)", rec.Code, rec.Body)
	}
	var vr model.VerifyPinResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &vr); err != nil || !vr.Success || vr.Token == "" {
		t.Fatalf("verify response = %s (err %v), want success with token", rec.Body, err)
	}

	// Token works
	rec = do(t, rt, http.MethodGet, "/api/balance", reqOpts{origin: testOrigin, token: vr.Token})
	if rec.Code != http.StatusOK {
		t.Errorf("balance with minted token = %d, want 200", rec.Code)
	}

	// Logout revokes
	rec = do(t, rt, http.MethodPost, "/api/auth/logout", reqOpts{origin: testOrigin, token: vr.Token})
	if rec.Code != http.StatusOK {
		t.Errorf("logout = %d, want 200", rec.Code)
	}
	rec = do(t, rt, http.MethodGet, "/api/balance", reqOpts{origin: testOrigin, token: vr.Token})
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("balance after logout = %d, want 401", rec.Code)
	}
}

// =====================================================================
// decodeStrict behaviors surface as 400s
// =====================================================================

func TestStrictBodyDecoding(t *testing.T) {
	rt, _ := newTestRouter(t)

	cases := []struct {
		name string
		body string
	}{
		{"malformed JSON", `{"pin": `},
		{"unknown field", `{"pin":"1234","extra":true}`},
		{"trailing data", `{"pin":"1234"} {"smuggled":1}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := do(t, rt, http.MethodPost, "/api/auth/setup", reqOpts{origin: testOrigin, body: tc.body})
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400", rec.Code)
			}
		})
	}
}

// =====================================================================
// Month endpoints
// =====================================================================

func TestMonthEndpoints(t *testing.T) {
	rt, repo := newTestRouter(t)

	t.Run("create month", func(t *testing.T) {
		rec := do(t, rt, http.MethodPost, "/api/month", authed(repo, `{"month":"2026-02"}`))
		if rec.Code != http.StatusCreated {
			t.Fatalf("create = %d, want 201 (body %s)", rec.Code, rec.Body)
		}
		rec = do(t, rt, http.MethodPost, "/api/month", authed(repo, `{"month":"2026-02"}`))
		if rec.Code != http.StatusConflict {
			t.Errorf("duplicate create = %d, want 409", rec.Code)
		}
		rec = do(t, rt, http.MethodPost, "/api/month", authed(repo, `{"month":"02-2026"}`))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("bad format = %d, want 400", rec.Code)
		}
	})

	t.Run("get month validates key", func(t *testing.T) {
		rec := do(t, rt, http.MethodGet, "/api/month/abcdefg", authed(repo, ""))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("bad month key = %d, want 400", rec.Code)
		}
		rec = do(t, rt, http.MethodGet, "/api/month/2026-02", authed(repo, ""))
		if rec.Code != http.StatusOK {
			t.Errorf("get month = %d, want 200", rec.Code)
		}
	})

	t.Run("add funds", func(t *testing.T) {
		rec := do(t, rt, http.MethodPost, "/api/month/2026-02/funds", authed(repo, `{"amount":50}`))
		if rec.Code != http.StatusOK {
			t.Errorf("funds = %d, want 200 (body %s)", rec.Code, rec.Body)
		}
		rec = do(t, rt, http.MethodPost, "/api/month/2030-01/funds", authed(repo, `{"amount":50}`))
		if rec.Code != http.StatusNotFound {
			t.Errorf("funds on missing month = %d, want 404", rec.Code)
		}
		rec = do(t, rt, http.MethodPost, "/api/month/2026-02/funds", authed(repo, `{"amount":-5}`))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("negative funds = %d, want 400", rec.Code)
		}
	})

	t.Run("list months rejects bad cursor", func(t *testing.T) {
		rec := do(t, rt, http.MethodGet, "/api/months?cursor=%25%25", authed(repo, ""))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("undecodable cursor = %d, want 400", rec.Code)
		}
		// Valid base64 ("MjAyMC0wMQ==" = "2020-01") but not a real month in the list.
		rec = do(t, rt, http.MethodGet, "/api/months?cursor=MjAyMC0wMQ%3D%3D", authed(repo, ""))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("fabricated cursor = %d, want 400", rec.Code)
		}
	})
}

// =====================================================================
// Expense endpoints
// =====================================================================

func TestExpenseEndpoints(t *testing.T) {
	rt, repo := newTestRouter(t)
	testutil.SeedMonth(repo, "2026-02", 0, 100, 0, 100)

	t.Run("add expense", func(t *testing.T) {
		rec := do(t, rt, http.MethodPost, "/api/expense", authed(repo, `{"amount":30,"description":"book","month":"2026-02"}`))
		if rec.Code != http.StatusCreated {
			t.Fatalf("add = %d, want 201 (body %s)", rec.Code, rec.Body)
		}
		rec = do(t, rt, http.MethodPost, "/api/expense", authed(repo, `{"amount":-1,"description":"x"}`))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("negative amount = %d, want 400", rec.Code)
		}
		// Hard-stop service: 500 > remaining 70.
		rec = do(t, rt, http.MethodPost, "/api/expense", authed(repo, `{"amount":500,"description":"x","month":"2026-02"}`))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("overspend = %d, want 400 (insufficient funds)", rec.Code)
		}
	})

	t.Run("update expense path validation", func(t *testing.T) {
		rec := do(t, rt, http.MethodPut, "/api/expense/2026-02", authed(repo, `{"amount":10}`))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("missing id segment = %d, want 400", rec.Code)
		}
		// SK without the EXP# prefix must be refused — this is the guard
		// against mutating SUMMARY rows through the expense API.
		rec = do(t, rt, http.MethodPut, "/api/expense/2026-02/SUMMARY", authed(repo, `{"amount":10}`))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("non-EXP SK = %d, want 400", rec.Code)
		}
		rec = do(t, rt, http.MethodPut, "/api/expense/2026-02/EXP%23missing", authed(repo, `{"amount":10}`))
		if rec.Code != http.StatusNotFound {
			t.Errorf("unknown expense = %d, want 404", rec.Code)
		}
	})

	t.Run("update and delete round trip", func(t *testing.T) {
		id := "EXP#1#abc"
		repo.Expenses[testutil.ExpenseKey("2026-02", id)] = &model.Expense{SK: id, Amount: 30, Description: "book"}

		rec := do(t, rt, http.MethodPut, "/api/expense/2026-02/EXP%231%23abc", authed(repo, `{"amount":20}`))
		if rec.Code != http.StatusOK {
			t.Fatalf("update = %d, want 200 (body %s)", rec.Code, rec.Body)
		}
		rec = do(t, rt, http.MethodDelete, "/api/expense/2026-02/EXP%231%23abc", authed(repo, ""))
		if rec.Code != http.StatusOK {
			t.Fatalf("delete = %d, want 200 (body %s)", rec.Code, rec.Body)
		}
		rec = do(t, rt, http.MethodDelete, "/api/expense/2026-02/EXP%231%23abc", authed(repo, ""))
		if rec.Code != http.StatusNotFound {
			t.Errorf("re-delete = %d, want 404", rec.Code)
		}
	})
}

// =====================================================================
// TestDeleteMonthEndpoint pins U2: DELETE /api/month/{m} removes an empty
// month (200) and refuses a month with expenses (409).
// =====================================================================
func TestDeleteMonthEndpoint(t *testing.T) {
	rt, repo := newTestRouter(t)

	t.Run("deletes an empty month", func(t *testing.T) {
		testutil.SeedMonth(repo, "2026-04", 0, 100, 0, 100)
		rec := do(t, rt, http.MethodDelete, "/api/month/2026-04", authed(repo, ""))
		if rec.Code != http.StatusOK {
			t.Fatalf("delete = %d, want 200 (body %s)", rec.Code, rec.Body)
		}
		if repo.Months["2026-04"] != nil {
			t.Error("month still present after delete")
		}
	})

	t.Run("refuses a month with expenses (409)", func(t *testing.T) {
		testutil.SeedMonth(repo, "2026-05", 0, 100, 30, 70)
		rec := do(t, rt, http.MethodDelete, "/api/month/2026-05", authed(repo, ""))
		if rec.Code != http.StatusConflict {
			t.Errorf("delete with expenses = %d, want 409 (body %s)", rec.Code, rec.Body)
		}
	})

	t.Run("missing month 404", func(t *testing.T) {
		rec := do(t, rt, http.MethodDelete, "/api/month/2030-12", authed(repo, ""))
		if rec.Code != http.StatusNotFound {
			t.Errorf("delete missing = %d, want 404", rec.Code)
		}
	})

	t.Run("bad month format 400", func(t *testing.T) {
		rec := do(t, rt, http.MethodDelete, "/api/month/not-a-month", authed(repo, ""))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("bad format = %d, want 400", rec.Code)
		}
	})
}

// =====================================================================
// TestCreateMonthIdempotentAllowance pins U1 end-to-end: POSTing /api/month
// for a month auto-created by an expense (with $0 allowance) activates the
// allowance with 201 instead of 409.
// =====================================================================
func TestCreateMonthIdempotentAllowance(t *testing.T) {
	rt, repo := newTestRouter(t)
	testutil.SeedMonth(repo, "2026-06", 0, 0, 0, 0) // $0-allowance auto-created shape

	rec := do(t, rt, http.MethodPost, "/api/month", authed(repo, `{"month":"2026-06"}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("activate = %d, want 201 (body %s)", rec.Code, rec.Body)
	}
	var resp model.CreateMonthResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Summary.AllowanceAdded != 100 {
		t.Errorf("AllowanceAdded = %v, want 100", resp.Summary.AllowanceAdded)
	}
}

// =====================================================================
// TestInsufficientFundsIncludesAvailable pins U4: a hard-stop refusal
// returns 400 with the available balance in the body.
// =====================================================================
func TestInsufficientFundsIncludesAvailable(t *testing.T) {
	rt, repo := newTestRouter(t)
	testutil.SeedMonth(repo, "2026-02", 0, 100, 0, 100)

	rec := do(t, rt, http.MethodPost, "/api/expense", authed(repo, `{"amount":500,"description":"x","month":"2026-02"}`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("overspend = %d, want 400 (body %s)", rec.Code, rec.Body)
	}
	var body struct {
		Error     string  `json:"error"`
		Available float64 `json:"available"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if body.Available != 100 {
		t.Errorf("available = %v, want 100", body.Available)
	}
}

// =====================================================================
// TestVerifyRateLimited429 pins U3 end-to-end: once the per-IP cap is hit,
// /api/auth/verify returns 429 with a Retry-After header and a
// retry_after_seconds body field.
// =====================================================================
func TestVerifyRateLimited429(t *testing.T) {
	rt, repo := newTestRouter(t)
	// Setup a PIN so verify reaches the hash path.
	rec := do(t, rt, http.MethodPost, "/api/auth/setup", reqOpts{origin: testOrigin, body: `{"pin":"1234"}`})
	if rec.Code != http.StatusOK {
		t.Fatalf("setup = %d, want 200", rec.Code)
	}
	// Pre-cap the source-IP bucket. httptest requests carry no X-Source-Ip
	// header, so the handler passes "" to the service, and the FakeRepo
	// keys its rate-limit map by that raw sourceIP value.
	ttl := time.Now().Add(10 * time.Minute).Unix()
	repo.RateLimits[""] = &model.RateLimitEntry{Attempts: 5, TTL: ttl}

	rec = do(t, rt, http.MethodPost, "/api/auth/verify", reqOpts{origin: testOrigin, body: `{"pin":"1234"}`})
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("rate-limited verify = %d, want 429 (body %s)", rec.Code, rec.Body)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Error("Retry-After header missing on 429")
	}
	var vr model.VerifyPinResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &vr); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if vr.RetryAfterSeconds == nil || *vr.RetryAfterSeconds <= 0 {
		t.Errorf("retry_after_seconds = %v, want positive", vr.RetryAfterSeconds)
	}
	if vr.AttemptsRemaining == nil || *vr.AttemptsRemaining != 0 {
		t.Errorf("attempts_remaining = %v, want non-nil 0 (omitempty trap fixed)", vr.AttemptsRemaining)
	}
}

// =====================================================================
// TestRefererOriginExactMatch pins S1: a Referer whose host merely has the
// allowed origin as a prefix (app.example.evil.com) must be rejected; a
// real same-origin Referer with a path must pass.
// =====================================================================
func TestRefererOriginExactMatch(t *testing.T) {
	rt, _ := newTestRouter(t)

	t.Run("suffix-host referer rejected", func(t *testing.T) {
		rec := do(t, rt, http.MethodGet, "/api/auth/status", reqOpts{referer: "https://app.example.evil.com/passbook/"})
		if rec.Code != http.StatusForbidden {
			t.Errorf("evil suffix referer = %d, want 403", rec.Code)
		}
	})

	t.Run("real same-origin referer with path passes", func(t *testing.T) {
		rec := do(t, rt, http.MethodGet, "/api/auth/status", reqOpts{referer: testOrigin + "/passbook/kids/"})
		if rec.Code != http.StatusOK {
			t.Errorf("same-origin referer = %d, want 200", rec.Code)
		}
	})

	t.Run("different scheme rejected", func(t *testing.T) {
		rec := do(t, rt, http.MethodGet, "/api/auth/status", reqOpts{referer: "http://app.example/"})
		if rec.Code != http.StatusForbidden {
			t.Errorf("http (vs https) referer = %d, want 403", rec.Code)
		}
	})
}

// TestValidateExpenseID pins the SK prefix guard directly.
func TestValidateExpenseID(t *testing.T) {
	cases := map[string]bool{
		"EXP#123#abc": true,
		"EXP#":        false, // prefix alone is not an ID
		"SUMMARY":     false,
		"":            false,
		"exp#1":       false, // case-sensitive
	}
	for id, want := range cases {
		if got := validateExpenseID(id); got != want {
			t.Errorf("validateExpenseID(%q) = %v, want %v", id, got, want)
		}
	}
}
