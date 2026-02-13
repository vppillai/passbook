package handler

import (
	"encoding/json"
	"net/http"
	"net/url"
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
	response, err := rt.expenseService.ListMonths(r.Context())
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

	response, err := rt.expenseService.GetMonthData(r.Context(), month)
	if err != nil {
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

func (rt *Router) handleDeleteExpense(w http.ResponseWriter, r *http.Request) {
	// Extract expense ID from path: /api/expense/MONTH#2026-02/EXP#...
	path := r.URL.Path
	parts := strings.TrimPrefix(path, "/api/expense/")

	// Expected format: {month}/{expenseID}
	segments := strings.SplitN(parts, "/", 2)
	if len(segments) != 2 {
		http.Error(w, `{"error":"Invalid expense path"}`, http.StatusBadRequest)
		return
	}

	month := segments[0]
	expenseID, err := url.PathUnescape(segments[1])
	if err != nil {
		http.Error(w, `{"error":"Invalid expense ID"}`, http.StatusBadRequest)
		return
	}

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
