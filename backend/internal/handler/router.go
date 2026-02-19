package handler

import (
	"net/http"
	"strings"

	"github.com/vppillai/passbook/backend/internal/middleware"
	"github.com/vppillai/passbook/backend/internal/service"
)

// Router handles HTTP routing
type Router struct {
	authService    *service.AuthService
	expenseService *service.ExpenseService
	allowedOrigin  string
}

// NewRouter creates a new router
func NewRouter(authService *service.AuthService, expenseService *service.ExpenseService, allowedOrigin string) *Router {
	return &Router{
		authService:    authService,
		expenseService: expenseService,
		allowedOrigin:  allowedOrigin,
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

	path := r.URL.Path
	method := r.Method

	// Health check is always allowed (for monitoring)
	if path == "/api/health" && method == http.MethodGet {
		w.Write([]byte(`{"status":"ok"}`))
		return
	}

	// Validate Origin header for all other requests
	// This provides defense-in-depth beyond CORS
	origin := r.Header.Get("Origin")
	if origin != "" && origin != rt.allowedOrigin {
		http.Error(w, `{"error":"Forbidden"}`, http.StatusForbidden)
		return
	}

	// For non-browser requests (no Origin header), check Referer as fallback
	// This blocks direct API access from tools like curl without Origin header
	if origin == "" {
		referer := r.Header.Get("Referer")
		if referer != "" && !strings.HasPrefix(referer, rt.allowedOrigin) {
			http.Error(w, `{"error":"Forbidden"}`, http.StatusForbidden)
			return
		}
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
	}

	// Protected routes - require auth
	authMiddleware := middleware.Auth(rt.authService)
	protectedHandler := authMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rt.protectedRoute(w, r)
	}))
	protectedHandler.ServeHTTP(w, r)
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
