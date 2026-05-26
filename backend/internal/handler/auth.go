package handler

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"github.com/vppillai/passbook/backend/internal/middleware"
	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/service"
)

// errTrailingJSON is returned by decodeStrict when the body contains
// extra tokens past the first JSON value. Folded into the handler's
// "Invalid request body" 400 mapping.
var errTrailingJSON = errors.New("unexpected trailing data in request body")

// decodeStrict wraps json.NewDecoder().Decode() with two defenses:
//   - DisallowUnknownFields → typos in field names fail loudly instead
//     of being silently dropped.
//   - dec.More() → reject trailing tokens after the first JSON value,
//     so callers can't smuggle a second object or garbage past us.
//
// Returns the same error semantics as Decode (caller maps to 400).
func decodeStrict(body interface{}, r *http.Request) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(body); err != nil {
		return err
	}
	if dec.More() {
		return errTrailingJSON
	}
	return nil
}

func (rt *Router) handleSetupStatus(w http.ResponseWriter, r *http.Request) {
	isSetup, err := rt.authService.IsSetup(r.Context())
	if err != nil {
		log.Printf("auth.status: %v", err)
		http.Error(w, `{"error":"Failed to check setup status"}`, http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(model.SetupStatusResponse{IsSetup: isSetup})
}

func (rt *Router) handleSetupPIN(w http.ResponseWriter, r *http.Request) {
	var req model.SetupPinRequest
	if err := decodeStrict(&req, r); err != nil {
		http.Error(w, `{"error":"Invalid request body"}`, http.StatusBadRequest)
		return
	}

	if err := rt.authService.SetupPIN(r.Context(), req.Pin); err != nil {
		switch {
		case errors.Is(err, service.ErrPINAlreadySet):
			http.Error(w, `{"error":"PIN already set up"}`, http.StatusConflict)
		case errors.Is(err, service.ErrPINTooShort):
			http.Error(w, `{"error":"PIN must be 4-6 digits"}`, http.StatusBadRequest)
		case errors.Is(err, service.ErrPINNotNumeric):
			http.Error(w, `{"error":"PIN must contain only digits"}`, http.StatusBadRequest)
		default:
			log.Printf("auth.setup: %v", err)
			http.Error(w, `{"error":"Failed to set up PIN"}`, http.StatusInternalServerError)
		}
		return
	}

	json.NewEncoder(w).Encode(model.SuccessResponse{Success: true, Message: "PIN set up successfully"})
}

func (rt *Router) handleVerifyPIN(w http.ResponseWriter, r *http.Request) {
	var req model.VerifyPinRequest
	if err := decodeStrict(&req, r); err != nil {
		http.Error(w, `{"error":"Invalid request body"}`, http.StatusBadRequest)
		return
	}

	response, err := rt.authService.VerifyPIN(r.Context(), req.Pin, r.Header.Get(SourceIPHeader))
	if err != nil {
		log.Printf("auth.verify: %v", err)
		http.Error(w, `{"error":"Failed to verify PIN"}`, http.StatusInternalServerError)
		return
	}

	if !response.Success {
		w.WriteHeader(http.StatusUnauthorized)
	}
	json.NewEncoder(w).Encode(response)
}

func (rt *Router) handleChangePIN(w http.ResponseWriter, r *http.Request) {
	var req model.ChangePinRequest
	if err := decodeStrict(&req, r); err != nil {
		http.Error(w, `{"error":"Invalid request body"}`, http.StatusBadRequest)
		return
	}

	if err := rt.authService.ChangePIN(r.Context(), req.CurrentPin, req.NewPin); err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidPIN):
			http.Error(w, `{"error":"Current PIN is incorrect"}`, http.StatusUnauthorized)
		case errors.Is(err, service.ErrPINTooShort):
			http.Error(w, `{"error":"New PIN must be 4-6 digits"}`, http.StatusBadRequest)
		case errors.Is(err, service.ErrPINNotNumeric):
			http.Error(w, `{"error":"New PIN must contain only digits"}`, http.StatusBadRequest)
		default:
			log.Printf("auth.change: %v", err)
			http.Error(w, `{"error":"Failed to change PIN"}`, http.StatusInternalServerError)
		}
		return
	}

	json.NewEncoder(w).Encode(model.SuccessResponse{Success: true, Message: "PIN changed successfully"})
}

func (rt *Router) handleLogout(w http.ResponseWriter, r *http.Request) {
	token := middleware.GetSessionToken(r.Context())
	if token != "" {
		if err := rt.authService.Logout(r.Context(), token); err != nil {
			// Don't claim logout succeeded if the DDB delete failed —
			// the token may still be valid server-side and a client
			// that trusts our success would stop trying to revoke.
			log.Printf("auth.logout: %v", err)
			http.Error(w, `{"error":"Failed to revoke session"}`, http.StatusInternalServerError)
			return
		}
	}
	json.NewEncoder(w).Encode(model.SuccessResponse{Success: true})
}
