package handler

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/service"
)

func (rt *Router) handleGetBalance(w http.ResponseWriter, r *http.Request) {
	response, err := rt.expenseService.GetBalance(r.Context())
	if err != nil {
		http.Error(w, `{"error":"Failed to get balance"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(response)
}

func (rt *Router) handleListMonths(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.ParseInt(l, 10, 32); err == nil && parsed > 0 && parsed <= 100 {
			limit = int(parsed)
		}
	}

	cursorMonth := ""
	if cursorStr := r.URL.Query().Get("cursor"); cursorStr != "" {
		decoded, err := base64.URLEncoding.DecodeString(cursorStr)
		if err == nil {
			cursorMonth = string(decoded)
		}
	}

	response, err := rt.expenseService.ListMonths(r.Context(), limit, cursorMonth)
	if err != nil {
		http.Error(w, `{"error":"Failed to list months"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(response)
}

func (rt *Router) handleGetMonth(w http.ResponseWriter, r *http.Request) {
	// Extract month from path: /api/month/2026-02
	path := r.URL.Path
	month := strings.TrimPrefix(path, "/api/month/")

	if month == "" || len(month) != 7 {
		http.Error(w, `{"error":"Invalid month format. Use YYYY-MM"}`, http.StatusBadRequest)
		return
	}

	// Parse pagination params
	limit := int32(50)
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.ParseInt(l, 10, 32); err == nil && parsed > 0 && parsed <= 100 {
			limit = int32(parsed)
		}
	}
	cursor := r.URL.Query().Get("cursor")

	response, err := rt.expenseService.GetMonthData(r.Context(), month, limit, cursor)
	if err != nil {
		if strings.Contains(err.Error(), "invalid cursor") {
			http.Error(w, `{"error":"Invalid pagination cursor"}`, http.StatusBadRequest)
			return
		}
		http.Error(w, `{"error":"Failed to get month data"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(response)
}

func (rt *Router) handleAddExpense(w http.ResponseWriter, r *http.Request) {
	var req model.AddExpenseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"Invalid request body"}`, http.StatusBadRequest)
		return
	}

	response, err := rt.expenseService.AddExpense(r.Context(), &req)
	if err != nil {
		switch err {
		case service.ErrInvalidAmount:
			http.Error(w, `{"error":"Amount must be positive"}`, http.StatusBadRequest)
		case service.ErrDescriptionTooLong:
			http.Error(w, `{"error":"Description too long (max 100 characters)"}`, http.StatusBadRequest)
		case service.ErrInsufficientFunds:
			http.Error(w, `{"error":"Insufficient funds"}`, http.StatusBadRequest)
		default:
			http.Error(w, `{"error":"Failed to add expense"}`, http.StatusInternalServerError)
		}
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(response)
}

func (rt *Router) handleUpdateExpense(w http.ResponseWriter, r *http.Request) {
	// Extract month and expense ID from path: /api/expense/{month}/{expenseID}
	path := r.URL.Path
	parts := strings.TrimPrefix(path, "/api/expense/")
	segments := strings.SplitN(parts, "/", 2)
	if len(segments) != 2 {
		http.Error(w, `{"error":"Invalid expense path"}`, http.StatusBadRequest)
		return
	}

	month := segments[0]
	expenseID := segments[1]

	var req model.UpdateExpenseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"Invalid request body"}`, http.StatusBadRequest)
		return
	}

	response, err := rt.expenseService.UpdateExpense(r.Context(), month, expenseID, &req)
	if err != nil {
		switch err {
		case service.ErrInvalidAmount:
			http.Error(w, `{"error":"Amount must be positive"}`, http.StatusBadRequest)
		case service.ErrDescriptionTooLong:
			http.Error(w, `{"error":"Description too long (max 100 characters)"}`, http.StatusBadRequest)
		case service.ErrNoChanges:
			http.Error(w, `{"error":"No changes provided"}`, http.StatusBadRequest)
		case service.ErrInsufficientFunds:
			http.Error(w, `{"error":"Insufficient funds for this amount change"}`, http.StatusBadRequest)
		case service.ErrExpenseNotFound:
			http.Error(w, `{"error":"Expense not found"}`, http.StatusNotFound)
		default:
			http.Error(w, `{"error":"Failed to update expense"}`, http.StatusInternalServerError)
		}
		return
	}

	json.NewEncoder(w).Encode(response)
}

func (rt *Router) handleDeleteExpense(w http.ResponseWriter, r *http.Request) {
	// Extract expense ID from path: /api/expense/2026-02/EXP#...
	// Note: Path is already URL-decoded by API Gateway
	path := r.URL.Path
	parts := strings.TrimPrefix(path, "/api/expense/")

	// Expected format: {month}/{expenseID}
	segments := strings.SplitN(parts, "/", 2)
	if len(segments) != 2 {
		http.Error(w, `{"error":"Invalid expense path"}`, http.StatusBadRequest)
		return
	}

	month := segments[0]
	expenseID := segments[1]

	if err := rt.expenseService.DeleteExpense(r.Context(), month, expenseID); err != nil {
		switch err {
		case service.ErrExpenseNotFound:
			http.Error(w, `{"error":"Expense not found"}`, http.StatusNotFound)
		default:
			http.Error(w, `{"error":"Failed to delete expense"}`, http.StatusInternalServerError)
		}
		return
	}

	json.NewEncoder(w).Encode(model.SuccessResponse{Success: true, Message: "Expense deleted"})
}

func (rt *Router) handleCreateMonth(w http.ResponseWriter, r *http.Request) {
	var req model.CreateMonthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"Invalid request body"}`, http.StatusBadRequest)
		return
	}

	response, err := rt.expenseService.CreateMonth(r.Context(), req.Month)
	if err != nil {
		switch err {
		case service.ErrInvalidMonth:
			http.Error(w, `{"error":"Invalid month format. Use YYYY-MM"}`, http.StatusBadRequest)
		case service.ErrMonthExists:
			http.Error(w, `{"error":"Month already exists"}`, http.StatusConflict)
		default:
			http.Error(w, `{"error":"Failed to create month"}`, http.StatusInternalServerError)
		}
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(response)
}

func (rt *Router) handleAddFunds(w http.ResponseWriter, r *http.Request) {
	// Extract month from path: /api/month/{month}/funds
	path := r.URL.Path
	trimmed := strings.TrimPrefix(path, "/api/month/")
	month := strings.TrimSuffix(trimmed, "/funds")

	if month == "" || len(month) != 7 {
		http.Error(w, `{"error":"Invalid month format. Use YYYY-MM"}`, http.StatusBadRequest)
		return
	}

	var req model.AddFundsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"Invalid request body"}`, http.StatusBadRequest)
		return
	}

	response, err := rt.expenseService.AddFunds(r.Context(), month, req.Amount)
	if err != nil {
		switch err {
		case service.ErrFundsNotPositive:
			http.Error(w, `{"error":"Amount must be positive"}`, http.StatusBadRequest)
		case service.ErrMonthNotFound:
			http.Error(w, `{"error":"Month not found"}`, http.StatusNotFound)
		default:
			http.Error(w, `{"error":"Failed to add funds"}`, http.StatusInternalServerError)
		}
		return
	}

	json.NewEncoder(w).Encode(response)
}
