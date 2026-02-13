package middleware

import (
	"context"
	"net/http"

	"github.com/vppillai/passbook/backend/internal/service"
)

type contextKey string

const SessionTokenKey contextKey = "session_token"

// Auth returns a middleware that validates session tokens
func Auth(authService *service.AuthService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := r.Header.Get("X-Session-Token")

			valid, err := authService.ValidateSession(r.Context(), token)
			if err != nil {
				http.Error(w, `{"error":"Internal server error"}`, http.StatusInternalServerError)
				return
			}

			if !valid {
				http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
				return
			}

			// Add token to context
			ctx := context.WithValue(r.Context(), SessionTokenKey, token)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// GetSessionToken extracts session token from context
func GetSessionToken(ctx context.Context) string {
	token, _ := ctx.Value(SessionTokenKey).(string)
	return token
}
