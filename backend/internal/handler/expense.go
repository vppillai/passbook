package handler

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/repository"
	"github.com/vppillai/passbook/backend/internal/service"
)

// validateExpenseID gates expense-API mutations to rows whose SK actually
// begins with "EXP#". Without this, an authenticated caller could PUT or
// DELETE arbitrary rows (e.g. SK="SUMMARY") under any month, corrupting
// the ledger via the expense endpoint. The repository layer adds a
// matching ConditionExpression as defense-in-depth.
func validateExpenseID(id string) bool {
	return strings.HasPrefix(id, repository.ExpensePrefix) && len(id) > len(repository.ExpensePrefix)
}

// validateMonthKey delegates to service.ValidateMonth — the single source
// of truth for the YYYY-MM rule shared by the handler and the service layer
// (Q2). Kept as a thin handler-local wrapper so the call sites stay terse.
func validateMonthKey(month string) error {
	return service.ValidateMonth(month)
}

func (rt *Router) handleGetBalance(w http.ResponseWriter, r *http.Request) {
	response, err := rt.expenseService.GetBalance(r.Context())
	if err != nil {
		log.Printf("balance.get: %v", err)
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

	// A malformed cursor now returns 400 instead of being silently
	// dropped. Consistent with the /api/month/{m} handler below; prevents
	// the duplicate-page-replay UX bug where a typo'd token kept
	// returning page 1.
	cursorMonth := ""
	if cursorStr := r.URL.Query().Get("cursor"); cursorStr != "" {
		decoded, err := base64.URLEncoding.DecodeString(cursorStr)
		if err != nil {
			http.Error(w, `{"error":"Invalid pagination cursor"}`, http.StatusBadRequest)
			return
		}
		cursorMonth = string(decoded)
	}

	response, err := rt.expenseService.ListMonths(r.Context(), limit, cursorMonth)
	if err != nil {
		if errors.Is(err, service.ErrInvalidCursor) {
			http.Error(w, `{"error":"Invalid pagination cursor"}`, http.StatusBadRequest)
			return
		}
		log.Printf("months.list: %v", err)
		http.Error(w, `{"error":"Failed to list months"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(response)
}

func (rt *Router) handleGetMonth(w http.ResponseWriter, r *http.Request) {
	// Extract month from path: /api/month/2026-02
	path := r.URL.Path
	month := strings.TrimPrefix(path, "/api/month/")

	if err := validateMonthKey(month); err != nil {
		http.Error(w, `{"error":"Invalid month format. Use YYYY-MM"}`, http.StatusBadRequest)
		return
	}

	limit := int32(50)
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.ParseInt(l, 10, 32); err == nil && parsed > 0 && parsed <= 100 {
			limit = int32(parsed)
		}
	}
	cursor := r.URL.Query().Get("cursor")

	response, err := rt.expenseService.GetMonthData(r.Context(), month, limit, cursor)
	if err != nil {
		if errors.Is(err, service.ErrInvalidCursor) {
			http.Error(w, `{"error":"Invalid pagination cursor"}`, http.StatusBadRequest)
			return
		}
		log.Printf("month.get: %v", err)
		http.Error(w, `{"error":"Failed to get month data"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(response)
}

func (rt *Router) handleAddExpense(w http.ResponseWriter, r *http.Request) {
	var req model.AddExpenseRequest
	if err := decodeStrict(&req, r); err != nil {
		http.Error(w, `{"error":"Invalid request body"}`, http.StatusBadRequest)
		return
	}

	response, err := rt.expenseService.AddExpense(r.Context(), &req)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidAmount):
			http.Error(w, `{"error":"Amount must be positive"}`, http.StatusBadRequest)
		case errors.Is(err, service.ErrInvalidMonth):
			http.Error(w, `{"error":"Invalid month format. Use YYYY-MM"}`, http.StatusBadRequest)
		case errors.Is(err, service.ErrInvalidDate):
			http.Error(w, `{"error":"Invalid date format. Use YYYY-MM-DD"}`, http.StatusBadRequest)
		case errors.Is(err, service.ErrFutureDate):
			http.Error(w, `{"error":"Date cannot be in the future"}`, http.StatusBadRequest)
		case errors.Is(err, service.ErrDateMonthMismatch):
			http.Error(w, `{"error":"Date does not match the provided month"}`, http.StatusBadRequest)
		case errors.Is(err, service.ErrDescriptionTooLong):
			http.Error(w, `{"error":"Description too long (max 100 characters)"}`, http.StatusBadRequest)
		case errors.Is(err, service.ErrInsufficientFunds):
			writeInsufficientFunds(w, err)
		default:
			log.Printf("expense.add: %v", err)
			http.Error(w, `{"error":"Failed to add expense"}`, http.StatusInternalServerError)
		}
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(response)
}

// writeInsufficientFunds returns a 400 whose message includes the available
// balance when the service supplied it (U4), falling back to the bare
// message otherwise.
func writeInsufficientFunds(w http.ResponseWriter, err error) {
	var insufficient *service.InsufficientFundsError
	if errors.As(err, &insufficient) {
		body := struct {
			Error     string  `json:"error"`
			Available float64 `json:"available"`
		}{
			Error:     "Insufficient funds",
			Available: insufficient.Available,
		}
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(body)
		return
	}
	http.Error(w, `{"error":"Insufficient funds"}`, http.StatusBadRequest)
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
	if err := validateMonthKey(month); err != nil {
		http.Error(w, `{"error":"Invalid month format. Use YYYY-MM"}`, http.StatusBadRequest)
		return
	}
	if !validateExpenseID(expenseID) {
		http.Error(w, `{"error":"Invalid expense ID"}`, http.StatusBadRequest)
		return
	}

	var req model.UpdateExpenseRequest
	if err := decodeStrict(&req, r); err != nil {
		http.Error(w, `{"error":"Invalid request body"}`, http.StatusBadRequest)
		return
	}

	response, err := rt.expenseService.UpdateExpense(r.Context(), month, expenseID, &req)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidAmount):
			http.Error(w, `{"error":"Amount must be positive"}`, http.StatusBadRequest)
		case errors.Is(err, service.ErrDescriptionTooLong):
			http.Error(w, `{"error":"Description too long (max 100 characters)"}`, http.StatusBadRequest)
		case errors.Is(err, service.ErrNoChanges):
			http.Error(w, `{"error":"No changes provided"}`, http.StatusBadRequest)
		case errors.Is(err, service.ErrInsufficientFunds):
			writeInsufficientFunds(w, err)
		case errors.Is(err, service.ErrExpenseModified):
			// Concurrent edit landed between read and write — tell the
			// client to refresh, with 409 not a misleading 404 (U4).
			http.Error(w, `{"error":"Expense was modified, please refresh and try again"}`, http.StatusConflict)
		case errors.Is(err, service.ErrExpenseNotFound):
			http.Error(w, `{"error":"Expense not found"}`, http.StatusNotFound)
		default:
			log.Printf("expense.update: %v", err)
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
	if err := validateMonthKey(month); err != nil {
		http.Error(w, `{"error":"Invalid month format. Use YYYY-MM"}`, http.StatusBadRequest)
		return
	}
	if !validateExpenseID(expenseID) {
		http.Error(w, `{"error":"Invalid expense ID"}`, http.StatusBadRequest)
		return
	}

	if err := rt.expenseService.DeleteExpense(r.Context(), month, expenseID); err != nil {
		switch {
		case errors.Is(err, service.ErrExpenseModified):
			http.Error(w, `{"error":"Expense was modified, please refresh and try again"}`, http.StatusConflict)
		case errors.Is(err, service.ErrExpenseNotFound):
			http.Error(w, `{"error":"Expense not found"}`, http.StatusNotFound)
		default:
			log.Printf("expense.delete: %v", err)
			http.Error(w, `{"error":"Failed to delete expense"}`, http.StatusInternalServerError)
		}
		return
	}

	json.NewEncoder(w).Encode(model.SuccessResponse{Success: true, Message: "Expense deleted"})
}

func (rt *Router) handleCreateMonth(w http.ResponseWriter, r *http.Request) {
	var req model.CreateMonthRequest
	if err := decodeStrict(&req, r); err != nil {
		http.Error(w, `{"error":"Invalid request body"}`, http.StatusBadRequest)
		return
	}

	response, err := rt.expenseService.CreateMonth(r.Context(), req.Month)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidMonth):
			http.Error(w, `{"error":"Invalid month format. Use YYYY-MM"}`, http.StatusBadRequest)
		case errors.Is(err, service.ErrMonthExists):
			http.Error(w, `{"error":"Month already exists"}`, http.StatusConflict)
		default:
			log.Printf("month.create: %v", err)
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

	if err := validateMonthKey(month); err != nil {
		http.Error(w, `{"error":"Invalid month format. Use YYYY-MM"}`, http.StatusBadRequest)
		return
	}

	var req model.AddFundsRequest
	if err := decodeStrict(&req, r); err != nil {
		http.Error(w, `{"error":"Invalid request body"}`, http.StatusBadRequest)
		return
	}

	response, err := rt.expenseService.AddFunds(r.Context(), month, req.Amount)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrFundsNotPositive):
			http.Error(w, `{"error":"Amount must be positive"}`, http.StatusBadRequest)
		case errors.Is(err, service.ErrMonthNotFound):
			http.Error(w, `{"error":"Month not found"}`, http.StatusNotFound)
		default:
			log.Printf("funds.add: %v", err)
			http.Error(w, `{"error":"Failed to add funds"}`, http.StatusInternalServerError)
		}
		return
	}

	json.NewEncoder(w).Encode(response)
}

func (rt *Router) handleDeleteMonth(w http.ResponseWriter, r *http.Request) {
	// Extract month from path: /api/month/{yyyy-mm}
	path := r.URL.Path
	month := strings.TrimPrefix(path, "/api/month/")

	if err := validateMonthKey(month); err != nil {
		http.Error(w, `{"error":"Invalid month format. Use YYYY-MM"}`, http.StatusBadRequest)
		return
	}

	if err := rt.expenseService.DeleteMonth(r.Context(), month); err != nil {
		switch {
		case errors.Is(err, service.ErrMonthNotFound):
			http.Error(w, `{"error":"Month not found"}`, http.StatusNotFound)
		case errors.Is(err, service.ErrMonthHasExpenses):
			http.Error(w, `{"error":"Cannot delete a month that still has expenses. Delete its expenses first."}`, http.StatusConflict)
		default:
			log.Printf("month.delete: %v", err)
			http.Error(w, `{"error":"Failed to delete month"}`, http.StatusInternalServerError)
		}
		return
	}

	json.NewEncoder(w).Encode(model.SuccessResponse{Success: true, Message: "Month deleted"})
}
