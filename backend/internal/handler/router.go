package handler

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/vppillai/passbook/backend/internal/middleware"
	"github.com/vppillai/passbook/backend/internal/service"
)

// SourceIPHeader carries the client's source IP from the Lambda entrypoint
// (which reads APIGW v2's event.RequestContext.HTTP.SourceIp) down to
// handlers. Any user-supplied value with this name is stripped before
// the trusted value is set in cmd/api/main.go, so the IP cannot be forged.
const SourceIPHeader = "X-Source-Ip"

// Router handles HTTP routing
type Router struct {
	authService     *service.AuthService
	expenseService  *service.ExpenseService
	webauthnService *service.WebAuthnService
	allowedOrigin   string
}

// NewRouter creates a new router. webauthnService may be nil if WebAuthn
// could not be configured (e.g. an unparsable ALLOWED_ORIGIN); the WebAuthn
// routes then return 503 and the status endpoint reports not-enrolled, so
// PIN auth keeps working.
func NewRouter(authService *service.AuthService, expenseService *service.ExpenseService, webauthnService *service.WebAuthnService, allowedOrigin string) *Router {
	return &Router{
		authService:     authService,
		expenseService:  expenseService,
		webauthnService: webauthnService,
		allowedOrigin:   allowedOrigin,
	}
}

// ServeHTTP implements http.Handler
func (rt *Router) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Apply CORS middleware
	handler := middleware.CORS(rt.allowedOrigin)(http.HandlerFunc(rt.route))
	handler.ServeHTTP(w, r)
}

func (rt *Router) route(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "strict-origin")
	w.Header().Set("Cache-Control", "no-store")

	path := r.URL.Path
	method := r.Method

	// Health check is always allowed (for monitoring)
	if path == "/api/health" && method == http.MethodGet {
		w.Write([]byte(`{"status":"ok"}`))
		return
	}

	// Defense-in-depth beyond CORS: every non-health request must carry
	// either a matching Origin or a matching Referer. Browsers attach one
	// or both for cross-origin fetches; direct API access from tools like
	// curl that sends neither will be rejected here. The previous version
	// allowed callers with NO Origin and NO Referer to pass — that hole
	// is now closed.
	origin := r.Header.Get("Origin")
	referer := r.Header.Get("Referer")
	originOK := origin != "" && origin == rt.allowedOrigin
	// Compare the Referer's parsed origin (scheme://host[:port]) EXACTLY
	// against the allowed origin. A bare HasPrefix let
	// "https://app.example.evil.com/..." pass when the allowed origin was
	// "https://app.example" (S1). Origin/Referer gating is defense-in-depth
	// only — trivially forged outside a browser — but it should not have a
	// bypass that looks like the real host.
	refererOK := referer != "" && sameOrigin(referer, rt.allowedOrigin)
	if !originOK && !refererOK {
		http.Error(w, `{"error":"Forbidden"}`, http.StatusForbidden)
		return
	}

	// Public routes (no auth required)
	switch {
	case path == "/api/auth/setup" && method == http.MethodPost:
		rt.handleSetupPIN(w, r)
		return
	case path == "/api/auth/verify" && method == http.MethodPost:
		rt.handleVerifyPIN(w, r)
		return
	case path == "/api/auth/status" && method == http.MethodGet:
		rt.handleSetupStatus(w, r)
		return
	case path == "/api/auth/webauthn/login/options" && method == http.MethodPost:
		rt.handleWebAuthnLoginOptions(w, r)
		return
	case path == "/api/auth/webauthn/login" && method == http.MethodPost:
		rt.handleWebAuthnLogin(w, r)
		return
	}

	// Protected routes - require auth
	authMiddleware := middleware.Auth(rt.authService)
	protectedHandler := authMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rt.protectedRoute(w, r)
	}))
	protectedHandler.ServeHTTP(w, r)
}

// sameOrigin reports whether refererURL has the same scheme://host[:port]
// origin as allowedOrigin. Both are parsed; a referer with a different host,
// scheme, or port (including a sneaky suffix like "app.example.evil.com")
// is rejected. allowedOrigin is expected to be scheme+host with no path.
func sameOrigin(refererURL, allowedOrigin string) bool {
	ref, err := url.Parse(refererURL)
	if err != nil {
		return false
	}
	allowed, err := url.Parse(allowedOrigin)
	if err != nil {
		return false
	}
	if ref.Scheme == "" || ref.Host == "" {
		return false
	}
	return ref.Scheme == allowed.Scheme && ref.Host == allowed.Host
}

func (rt *Router) protectedRoute(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	method := r.Method

	switch {
	case path == "/api/auth/change" && method == http.MethodPost:
		rt.handleChangePIN(w, r)
		return
	case path == "/api/auth/logout" && method == http.MethodPost:
		rt.handleLogout(w, r)
		return
	case path == "/api/auth/webauthn/register/options" && method == http.MethodPost:
		rt.handleWebAuthnRegisterOptions(w, r)
		return
	case path == "/api/auth/webauthn/register" && method == http.MethodPost:
		rt.handleWebAuthnRegister(w, r)
		return
	case path == "/api/auth/webauthn" && method == http.MethodDelete:
		rt.handleWebAuthnDisable(w, r)
		return
	case path == "/api/balance" && method == http.MethodGet:
		rt.handleGetBalance(w, r)
		return
	case path == "/api/months" && method == http.MethodGet:
		rt.handleListMonths(w, r)
		return
	case path == "/api/month" && method == http.MethodPost:
		rt.handleCreateMonth(w, r)
		return
	case strings.HasPrefix(path, "/api/month/") && strings.HasSuffix(path, "/funds") && method == http.MethodPost:
		rt.handleAddFunds(w, r)
		return
	case strings.HasPrefix(path, "/api/month/") && method == http.MethodGet:
		rt.handleGetMonth(w, r)
		return
	case strings.HasPrefix(path, "/api/month/") && method == http.MethodDelete:
		rt.handleDeleteMonth(w, r)
		return
	case path == "/api/expense" && method == http.MethodPost:
		rt.handleAddExpense(w, r)
		return
	case strings.HasPrefix(path, "/api/expense/") && method == http.MethodPut:
		rt.handleUpdateExpense(w, r)
		return
	case strings.HasPrefix(path, "/api/expense/") && method == http.MethodDelete:
		rt.handleDeleteExpense(w, r)
		return
	default:
		http.Error(w, `{"error":"Not found"}`, http.StatusNotFound)
	}
}
