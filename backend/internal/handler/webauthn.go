package handler

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"

	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/service"
)

// webauthnUnavailable writes a 503 when WebAuthn could not be configured at
// startup (nil service). PIN auth still works, so the client falls back.
func (rt *Router) webauthnUnavailable(w http.ResponseWriter) bool {
	if rt.webauthnService == nil {
		http.Error(w, `{"error":"WebAuthn is not available"}`, http.StatusServiceUnavailable)
		return true
	}
	return false
}

// handleWebAuthnRegisterOptions (POST /api/auth/webauthn/register/options)
// returns creation options for enrolling a new platform credential and
// persists the ceremony challenge. Requires a valid session.
func (rt *Router) handleWebAuthnRegisterOptions(w http.ResponseWriter, r *http.Request) {
	if rt.webauthnUnavailable(w) {
		return
	}
	resp, err := rt.webauthnService.BeginRegistration(r.Context())
	if err != nil {
		log.Printf("webauthn.register.options: %v", err)
		http.Error(w, `{"error":"Failed to start registration"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(resp)
}

// handleWebAuthnRegister (POST /api/auth/webauthn/register) verifies and
// stores a new credential. Requires a valid session.
func (rt *Router) handleWebAuthnRegister(w http.ResponseWriter, r *http.Request) {
	if rt.webauthnUnavailable(w) {
		return
	}
	var req model.WebAuthnVerifyRequest
	if err := decodeStrict(&req, r); err != nil {
		http.Error(w, `{"error":"Invalid request body"}`, http.StatusBadRequest)
		return
	}
	if err := rt.webauthnService.FinishRegistration(r.Context(), &req); err != nil {
		switch {
		case errors.Is(err, service.ErrWebAuthnChallengeNotFound):
			http.Error(w, `{"error":"Registration challenge expired, please retry"}`, http.StatusBadRequest)
		case errors.Is(err, service.ErrWebAuthnVerification):
			http.Error(w, `{"error":"Could not verify the authenticator"}`, http.StatusBadRequest)
		default:
			log.Printf("webauthn.register: %v", err)
			http.Error(w, `{"error":"Failed to register"}`, http.StatusInternalServerError)
		}
		return
	}
	json.NewEncoder(w).Encode(model.SuccessResponse{Success: true, Message: "Biometric unlock enabled"})
}

// handleWebAuthnLoginOptions (POST /api/auth/webauthn/login/options) returns
// userless login request options and persists the ceremony challenge. No auth.
func (rt *Router) handleWebAuthnLoginOptions(w http.ResponseWriter, r *http.Request) {
	if rt.webauthnUnavailable(w) {
		return
	}
	resp, err := rt.webauthnService.BeginLogin(r.Context())
	if err != nil {
		if errors.Is(err, service.ErrWebAuthnNotEnrolled) {
			http.Error(w, `{"error":"Biometric unlock is not set up"}`, http.StatusBadRequest)
			return
		}
		log.Printf("webauthn.login.options: %v", err)
		http.Error(w, `{"error":"Failed to start login"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(resp)
}

// handleWebAuthnLogin (POST /api/auth/webauthn/login) verifies the assertion
// and, on success, mints a session exactly like a successful PIN verify so the
// frontend flow is unchanged. Status-code handling mirrors handleVerifyPIN:
// 429 (with Retry-After) when rate-limited, 401 on a failed verification. No
// auth required.
func (rt *Router) handleWebAuthnLogin(w http.ResponseWriter, r *http.Request) {
	if rt.webauthnUnavailable(w) {
		return
	}
	var req model.WebAuthnVerifyRequest
	if err := decodeStrict(&req, r); err != nil {
		http.Error(w, `{"error":"Invalid request body"}`, http.StatusBadRequest)
		return
	}

	response, err := rt.webauthnService.FinishLogin(r.Context(), &req, r.Header.Get(SourceIPHeader))
	if err != nil {
		if errors.Is(err, service.ErrWebAuthnChallengeNotFound) {
			http.Error(w, `{"error":"Login challenge expired, please retry"}`, http.StatusBadRequest)
			return
		}
		log.Printf("webauthn.login: %v", err)
		http.Error(w, `{"error":"Failed to verify"}`, http.StatusInternalServerError)
		return
	}

	if !response.Success {
		// Rate-limited responses carry RetryAfterSeconds → 429 with a wait
		// time, distinct from a plain 401 failed verification.
		if response.RetryAfterSeconds != nil {
			if *response.RetryAfterSeconds > 0 {
				w.Header().Set("Retry-After", strconv.FormatInt(*response.RetryAfterSeconds, 10))
			}
			w.WriteHeader(http.StatusTooManyRequests)
		} else {
			w.WriteHeader(http.StatusUnauthorized)
		}
	}
	json.NewEncoder(w).Encode(response)
}

// handleWebAuthnDisable (DELETE /api/auth/webauthn) removes every stored
// credential so the user can turn off biometric unlock. Requires a valid
// session.
func (rt *Router) handleWebAuthnDisable(w http.ResponseWriter, r *http.Request) {
	if rt.webauthnUnavailable(w) {
		return
	}
	if err := rt.webauthnService.DisableWebAuthn(r.Context()); err != nil {
		log.Printf("webauthn.disable: %v", err)
		http.Error(w, `{"error":"Failed to disable biometric unlock"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(model.SuccessResponse{Success: true, Message: "Biometric unlock disabled"})
}
