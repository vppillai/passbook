package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/service"
	"github.com/vppillai/passbook/backend/internal/testutil"
)

const origin = "https://app.example"

func TestCORS(t *testing.T) {
	nextCalled := false
	handler := CORS(origin)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusTeapot) // sentinel so pass-through is visible
	}))

	t.Run("preflight with allowed origin", func(t *testing.T) {
		nextCalled = false
		req := httptest.NewRequest(http.MethodOptions, "/api/balance", nil)
		req.Header.Set("Origin", origin)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusNoContent {
			t.Errorf("preflight status = %d, want 204", rec.Code)
		}
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != origin {
			t.Errorf("ACAO = %q, want %q", got, origin)
		}
		if nextCalled {
			t.Error("preflight must short-circuit, next handler was called")
		}
	})

	t.Run("preflight with disallowed origin gets no CORS headers", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodOptions, "/api/balance", nil)
		req.Header.Set("Origin", "https://evil.example")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
			t.Errorf("ACAO = %q for disallowed origin, want empty", got)
		}
	})

	t.Run("normal request passes through with CORS headers", func(t *testing.T) {
		nextCalled = false
		req := httptest.NewRequest(http.MethodGet, "/api/balance", nil)
		req.Header.Set("Origin", origin)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if !nextCalled {
			t.Error("next handler not called for non-OPTIONS request")
		}
		if rec.Code != http.StatusTeapot {
			t.Errorf("status = %d, want sentinel 418", rec.Code)
		}
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != origin {
			t.Errorf("ACAO = %q, want %q", got, origin)
		}
	})
}

func TestAuthMiddleware(t *testing.T) {
	repo := testutil.NewFakeRepo()
	authSvc := service.NewAuthService(repo)

	var seenToken string
	nextCalled := false
	handler := Auth(authSvc)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		seenToken = GetSessionToken(r.Context())
	}))

	run := func(token string) (*httptest.ResponseRecorder, bool) {
		nextCalled = false
		req := httptest.NewRequest(http.MethodGet, "/api/balance", nil)
		if token != "" {
			req.Header.Set("X-Session-Token", token)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec, nextCalled
	}

	t.Run("missing token", func(t *testing.T) {
		rec, called := run("")
		if rec.Code != http.StatusUnauthorized || called {
			t.Errorf("got (%d, called=%v), want (401, false)", rec.Code, called)
		}
	})

	t.Run("invalid token", func(t *testing.T) {
		rec, called := run("bogus")
		if rec.Code != http.StatusUnauthorized || called {
			t.Errorf("got (%d, called=%v), want (401, false)", rec.Code, called)
		}
	})

	t.Run("valid token reaches handler with token in context", func(t *testing.T) {
		repo.Sessions["tok"] = &model.Session{Token: "tok"}
		rec, called := run("tok")
		if rec.Code != http.StatusOK || !called {
			t.Fatalf("got (%d, called=%v), want (200, true)", rec.Code, called)
		}
		if seenToken != "tok" {
			t.Errorf("GetSessionToken = %q, want \"tok\"", seenToken)
		}
	})
}
