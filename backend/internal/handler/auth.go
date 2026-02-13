package handler

import (
	"encoding/json"
	"net/http"

	"github.com/vppillai/passbook/backend/internal/middleware"
	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/service"
)

func (rt *Router) handleSetupStatus(w http.ResponseWriter, r *http.Request) {
	isSetup, err := rt.authService.IsSetup(r.Context())
	if err != nil {
		http.Error(w, `{"error":"Failed to check setup status"}`, http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(model.SetupStatusResponse{IsSetup: isSetup})
}

func (rt *Router) handleSetupPIN(w http.ResponseWriter, r *http.Request) {
	var req model.SetupPinRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"Invalid request body"}`, http.StatusBadRequest)
		return
	}

	if err := rt.authService.SetupPIN(r.Context(), req.Pin); err != nil {
		switch err {
		case service.ErrPINAlreadySet:
			http.Error(w, `{"error":"PIN already set up"}`, http.StatusConflict)
		case service.ErrPINTooShort:
			http.Error(w, `{"error":"PIN must be 4-6 digits"}`, http.StatusBadRequest)
		case service.ErrPINNotNumeric:
			http.Error(w, `{"error":"PIN must contain only digits"}`, http.StatusBadRequest)
		default:
			http.Error(w, `{"error":"Failed to set up PIN"}`, http.StatusInternalServerError)
		}
		return
	}

	json.NewEncoder(w).Encode(model.SuccessResponse{Success: true, Message: "PIN set up successfully"})
}

func (rt *Router) handleVerifyPIN(w http.ResponseWriter, r *http.Request) {
	var req model.VerifyPinRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"Invalid request body"}`, http.StatusBadRequest)
		return
	}

	response, err := rt.authService.VerifyPIN(r.Context(), req.Pin)
	if err != nil {
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"Invalid request body"}`, http.StatusBadRequest)
		return
	}

	if err := rt.authService.ChangePIN(r.Context(), req.CurrentPin, req.NewPin); err != nil {
		switch err {
		case service.ErrInvalidPIN:
			http.Error(w, `{"error":"Current PIN is incorrect"}`, http.StatusUnauthorized)
		case service.ErrPINTooShort:
			http.Error(w, `{"error":"New PIN must be 4-6 digits"}`, http.StatusBadRequest)
		case service.ErrPINNotNumeric:
			http.Error(w, `{"error":"New PIN must contain only digits"}`, http.StatusBadRequest)
		default:
			http.Error(w, `{"error":"Failed to change PIN"}`, http.StatusInternalServerError)
		}
		return
	}

	json.NewEncoder(w).Encode(model.SuccessResponse{Success: true, Message: "PIN changed successfully"})
}

func (rt *Router) handleLogout(w http.ResponseWriter, r *http.Request) {
	token := middleware.GetSessionToken(r.Context())
	if token != "" {
		rt.authService.Logout(r.Context(), token)
	}
	json.NewEncoder(w).Encode(model.SuccessResponse{Success: true})
}
