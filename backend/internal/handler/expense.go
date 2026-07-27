package handler

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/vppillai/passbook/backend/internal/httperr"
	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/repository"
	"github.com/vppillai/passbook/backend/internal/service"
)

// amountRangeMessage covers both ends of the amount rule. ErrInvalidAmount is
// returned for a non-positive amount AND for one above the 99999.99 ceiling,
// so the old "Amount must be positive" was actively misleading for the second
// case — a user who typed a large figure was told to make it positive.
const amountRangeMessage = "Amount must be between $0.01 and $99,999.99"

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
		httperr.WriteJSON(w, http.StatusInternalServerError, "Failed to get balance")
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
			httperr.WriteJSON(w, http.StatusBadRequest, "Invalid pagination cursor")
			return
		}
		cursorMonth = string(decoded)
	}

	response, err := rt.expenseService.ListMonths(r.Context(), limit, cursorMonth)
	if err != nil {
		if errors.Is(err, service.ErrInvalidCursor) {
			httperr.WriteJSON(w, http.StatusBadRequest, "Invalid pagination cursor")
			return
		}
		log.Printf("months.list: %v", err)
		httperr.WriteJSON(w, http.StatusInternalServerError, "Failed to list months")
		return
	}
	json.NewEncoder(w).Encode(response)
}

func (rt *Router) handleGetMonth(w http.ResponseWriter, r *http.Request) {
	// Extract month from path: /api/month/2026-02
	path := r.URL.Path
	month := strings.TrimPrefix(path, "/api/month/")

	if err := validateMonthKey(month); err != nil {
		httperr.WriteJSON(w, http.StatusBadRequest, "Invalid month format. Use YYYY-MM")
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
			httperr.WriteJSON(w, http.StatusBadRequest, "Invalid pagination cursor")
			return
		}
		log.Printf("month.get: %v", err)
		httperr.WriteJSON(w, http.StatusInternalServerError, "Failed to get month data")
		return
	}
	json.NewEncoder(w).Encode(response)
}

func (rt *Router) handleAddExpense(w http.ResponseWriter, r *http.Request) {
	var req model.AddExpenseRequest
	if err := decodeStrict(&req, r); err != nil {
		httperr.WriteJSON(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	response, err := rt.expenseService.AddExpense(r.Context(), &req)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidAmount):
			httperr.WriteJSON(w, http.StatusBadRequest, amountRangeMessage)
		case errors.Is(err, service.ErrInvalidMonth):
			httperr.WriteJSON(w, http.StatusBadRequest, "Invalid month format. Use YYYY-MM")
		case errors.Is(err, service.ErrInvalidDate):
			httperr.WriteJSON(w, http.StatusBadRequest, "Invalid date format. Use YYYY-MM-DD")
		case errors.Is(err, service.ErrFutureDate):
			httperr.WriteJSON(w, http.StatusBadRequest, "Date cannot be in the future")
		case errors.Is(err, service.ErrDateMonthMismatch):
			httperr.WriteJSON(w, http.StatusBadRequest, "Date does not match the provided month")
		case errors.Is(err, service.ErrDescriptionTooLong):
			httperr.WriteJSON(w, http.StatusBadRequest, "Description too long (max 100 characters)")
		case errors.Is(err, service.ErrInsufficientFunds):
			writeInsufficientFunds(w, err)
		default:
			log.Printf("expense.add: %v", err)
			httperr.WriteJSON(w, http.StatusInternalServerError, "Failed to add expense")
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
	httperr.WriteJSON(w, http.StatusBadRequest, "Insufficient funds")
}

func (rt *Router) handleUpdateExpense(w http.ResponseWriter, r *http.Request) {
	// Extract month and expense ID from path: /api/expense/{month}/{expenseID}
	path := r.URL.Path
	parts := strings.TrimPrefix(path, "/api/expense/")
	segments := strings.SplitN(parts, "/", 2)
	if len(segments) != 2 {
		httperr.WriteJSON(w, http.StatusBadRequest, "Invalid expense path")
		return
	}

	month := segments[0]
	expenseID := segments[1]
	if err := validateMonthKey(month); err != nil {
		httperr.WriteJSON(w, http.StatusBadRequest, "Invalid month format. Use YYYY-MM")
		return
	}
	if !validateExpenseID(expenseID) {
		httperr.WriteJSON(w, http.StatusBadRequest, "Invalid expense ID")
		return
	}

	var req model.UpdateExpenseRequest
	if err := decodeStrict(&req, r); err != nil {
		httperr.WriteJSON(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	response, err := rt.expenseService.UpdateExpense(r.Context(), month, expenseID, &req)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidAmount):
			httperr.WriteJSON(w, http.StatusBadRequest, amountRangeMessage)
		case errors.Is(err, service.ErrInvalidDate):
			httperr.WriteJSON(w, http.StatusBadRequest, "Invalid date format. Use YYYY-MM-DD")
		case errors.Is(err, service.ErrFutureDate):
			httperr.WriteJSON(w, http.StatusBadRequest, "Date cannot be in the future")
		case errors.Is(err, service.ErrDescriptionTooLong):
			httperr.WriteJSON(w, http.StatusBadRequest, "Description too long (max 100 characters)")
		case errors.Is(err, service.ErrNoChanges):
			httperr.WriteJSON(w, http.StatusBadRequest, "No changes provided")
		case errors.Is(err, service.ErrInsufficientFunds):
			writeInsufficientFunds(w, err)
		case errors.Is(err, service.ErrExpenseModified):
			// Concurrent edit landed between read and write — tell the
			// client to refresh, with 409 not a misleading 404 (U4).
			httperr.WriteJSON(w, http.StatusConflict, "Expense was modified, please refresh and try again")
		case errors.Is(err, service.ErrExpenseNotFound):
			httperr.WriteJSON(w, http.StatusNotFound, "Expense not found")
		default:
			log.Printf("expense.update: %v", err)
			httperr.WriteJSON(w, http.StatusInternalServerError, "Failed to update expense")
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
		httperr.WriteJSON(w, http.StatusBadRequest, "Invalid expense path")
		return
	}

	month := segments[0]
	expenseID := segments[1]
	if err := validateMonthKey(month); err != nil {
		httperr.WriteJSON(w, http.StatusBadRequest, "Invalid month format. Use YYYY-MM")
		return
	}
	if !validateExpenseID(expenseID) {
		httperr.WriteJSON(w, http.StatusBadRequest, "Invalid expense ID")
		return
	}

	if err := rt.expenseService.DeleteExpense(r.Context(), month, expenseID); err != nil {
		switch {
		case errors.Is(err, service.ErrExpenseModified):
			httperr.WriteJSON(w, http.StatusConflict, "Expense was modified, please refresh and try again")
		case errors.Is(err, service.ErrExpenseNotFound):
			httperr.WriteJSON(w, http.StatusNotFound, "Expense not found")
		default:
			log.Printf("expense.delete: %v", err)
			httperr.WriteJSON(w, http.StatusInternalServerError, "Failed to delete expense")
		}
		return
	}

	json.NewEncoder(w).Encode(model.SuccessResponse{Success: true, Message: "Expense deleted"})
}

func (rt *Router) handleCreateMonth(w http.ResponseWriter, r *http.Request) {
	var req model.CreateMonthRequest
	if err := decodeStrict(&req, r); err != nil {
		httperr.WriteJSON(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	response, err := rt.expenseService.CreateMonth(r.Context(), req.Month)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidMonth):
			httperr.WriteJSON(w, http.StatusBadRequest, "Invalid month format. Use YYYY-MM")
		case errors.Is(err, service.ErrMonthExists):
			httperr.WriteJSON(w, http.StatusConflict, "Month already exists")
		default:
			log.Printf("month.create: %v", err)
			httperr.WriteJSON(w, http.StatusInternalServerError, "Failed to create month")
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
		httperr.WriteJSON(w, http.StatusBadRequest, "Invalid month format. Use YYYY-MM")
		return
	}

	var req model.AddFundsRequest
	if err := decodeStrict(&req, r); err != nil {
		httperr.WriteJSON(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	response, err := rt.expenseService.AddFunds(r.Context(), month, req.Amount)
	if err != nil {
		switch {
		// Both ends of the amount rule are user error, not server error:
		// ErrFundsNotPositive for <= 0 and ErrInvalidAmount for above the
		// ceiling. Without the second case the over-cap rejection fell
		// through to a 500.
		case errors.Is(err, service.ErrFundsNotPositive),
			errors.Is(err, service.ErrInvalidAmount):
			httperr.WriteJSON(w, http.StatusBadRequest, amountRangeMessage)
		case errors.Is(err, service.ErrMonthNotFound):
			httperr.WriteJSON(w, http.StatusNotFound, "Month not found")
		default:
			log.Printf("funds.add: %v", err)
			httperr.WriteJSON(w, http.StatusInternalServerError, "Failed to add funds")
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
		httperr.WriteJSON(w, http.StatusBadRequest, "Invalid month format. Use YYYY-MM")
		return
	}

	if err := rt.expenseService.DeleteMonth(r.Context(), month); err != nil {
		switch {
		case errors.Is(err, service.ErrMonthNotFound):
			httperr.WriteJSON(w, http.StatusNotFound, "Month not found")
		case errors.Is(err, service.ErrMonthHasExpenses):
			httperr.WriteJSON(w, http.StatusConflict, "Cannot delete a month that still has expenses. Delete its expenses first.")
		default:
			log.Printf("month.delete: %v", err)
			httperr.WriteJSON(w, http.StatusInternalServerError, "Failed to delete month")
		}
		return
	}

	json.NewEncoder(w).Encode(model.SuccessResponse{Success: true, Message: "Month deleted"})
}
