package model

import "time"

// Config holds the application configuration (PIN hash)
type Config struct {
	PK        string    `dynamodbav:"PK"`
	SK        string    `dynamodbav:"SK"`
	PinHash   string    `dynamodbav:"pin_hash"`
	CreatedAt time.Time `dynamodbav:"created_at"`
	UpdatedAt time.Time `dynamodbav:"updated_at"`
}

// Balance holds the total accumulated balance
type Balance struct {
	PK           string    `dynamodbav:"PK"`
	SK           string    `dynamodbav:"SK"`
	TotalBalance float64   `dynamodbav:"total_balance"`
	UpdatedAt    time.Time `dynamodbav:"updated_at"`
}

// MonthSummary holds the summary for a specific month
type MonthSummary struct {
	PK              string    `dynamodbav:"PK" json:"-"`
	SK              string    `dynamodbav:"SK" json:"-"`
	Month           string    `dynamodbav:"month" json:"month"`
	StartingBalance float64   `dynamodbav:"starting_balance" json:"starting_balance"`
	AllowanceAdded  float64   `dynamodbav:"allowance_added" json:"allowance_added"`
	TotalExpenses   float64   `dynamodbav:"total_expenses" json:"total_expenses"`
	EndingBalance   float64   `dynamodbav:"ending_balance" json:"ending_balance"`
	CreatedAt       time.Time `dynamodbav:"created_at" json:"created_at"`
	UpdatedAt       time.Time `dynamodbav:"updated_at" json:"updated_at"`
}

// Expense represents a single expense entry
type Expense struct {
	PK          string    `dynamodbav:"PK"`
	SK          string    `dynamodbav:"SK"`
	Amount      float64   `dynamodbav:"amount"`
	Description string    `dynamodbav:"description"`
	CreatedAt   time.Time `dynamodbav:"created_at"`
}

// Session represents an authenticated session
type Session struct {
	PK        string `dynamodbav:"PK"`
	SK        string `dynamodbav:"SK"`
	Token     string `dynamodbav:"token"`
	CreatedAt int64  `dynamodbav:"created_at"`
	TTL       int64  `dynamodbav:"ttl"` // DynamoDB TTL for auto-expiry
}

// RateLimitEntry tracks failed PIN attempts
type RateLimitEntry struct {
	PK        string `dynamodbav:"PK"`
	SK        string `dynamodbav:"SK"`
	Attempts  int    `dynamodbav:"attempts"`
	LockedAt  int64  `dynamodbav:"locked_at,omitempty"`
	TTL       int64  `dynamodbav:"ttl"`
	UpdatedAt int64  `dynamodbav:"updated_at"`
}

// API Request/Response types

type SetupPinRequest struct {
	Pin string `json:"pin"`
}

type VerifyPinRequest struct {
	Pin string `json:"pin"`
}

type VerifyPinResponse struct {
	Success           bool   `json:"success"`
	Token             string `json:"token,omitempty"`
	Error             string `json:"error,omitempty"`
	AttemptsRemaining int    `json:"attempts_remaining,omitempty"`
	LockedUntil       int64  `json:"locked_until,omitempty"`
}

type ChangePinRequest struct {
	CurrentPin string `json:"current_pin"`
	NewPin     string `json:"new_pin"`
}

type AddExpenseRequest struct {
	Amount      float64 `json:"amount"`
	Description string  `json:"description"`
}

type AddExpenseResponse struct {
	Success       bool     `json:"success"`
	Expense       *Expense `json:"expense,omitempty"`
	MonthBalance  float64  `json:"month_balance"`
	TotalBalance  float64  `json:"total_balance"`
	Error         string   `json:"error,omitempty"`
}

// MonthDataResponse is returned when fetching data for a single month.
// It includes the month summary, a paginated list of expenses, the overall
// balance, and an opaque NextCursor for fetching the next page of expenses.
type MonthDataResponse struct {
	Month        string         `json:"month"`
	Summary      *MonthSummary  `json:"summary"`
	Expenses     []ExpenseItem  `json:"expenses"`
	TotalBalance float64        `json:"total_balance"`
	NextCursor   string         `json:"next_cursor,omitempty"` // Base64-encoded pagination cursor; empty when no more pages
}

type ExpenseItem struct {
	ID          string    `json:"id"`
	Amount      float64   `json:"amount"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
}

type MonthListItem struct {
	Month        string  `json:"month"`
	MonthlySaved float64 `json:"monthly_saved"` // allowance_added - total_expenses
}

// MonthsResponse is returned when listing all months. Months are sorted in
// descending order (most recent first). NextCursor is an opaque token used
// to fetch the next page of results.
type MonthsResponse struct {
	Months     []MonthListItem `json:"months"`
	NextCursor string          `json:"next_cursor,omitempty"` // Base64-encoded month value for cursor-based pagination; empty on the last page
}

type BalanceResponse struct {
	TotalBalance float64 `json:"total_balance"`
}

type SetupStatusResponse struct {
	IsSetup bool `json:"is_setup"`
}

// UpdateExpenseRequest is the JSON body for updating an existing expense.
// Both fields are optional pointers: a nil field means "do not change".
// At least one field must be non-nil for the request to be valid.
type UpdateExpenseRequest struct {
	Amount      *float64 `json:"amount,omitempty"`
	Description *string  `json:"description,omitempty"`
}

// UpdateExpenseResponse is returned after a successful expense update.
// It includes the updated expense details along with the recalculated
// month ending balance and overall total balance.
type UpdateExpenseResponse struct {
	Success      bool        `json:"success"`
	Expense      *ExpenseItem `json:"expense,omitempty"`
	MonthBalance float64     `json:"month_balance"`
	TotalBalance float64     `json:"total_balance"`
}

// CreateMonthRequest is the JSON body for creating a new monthly period.
// Month must be in "YYYY-MM" format (e.g. "2026-02").
type CreateMonthRequest struct {
	Month string `json:"month"`
}

// CreateMonthResponse is returned after successfully creating a new month.
// It contains the newly created month summary (including the configured
// allowance) and the updated total balance.
type CreateMonthResponse struct {
	Success      bool          `json:"success"`
	Summary      *MonthSummary `json:"summary"`
	TotalBalance float64       `json:"total_balance"`
}

// AddFundsRequest is the JSON body for adding extra funds (allowance top-up)
// to an existing month. Amount must be a positive value.
type AddFundsRequest struct {
	Amount float64 `json:"amount"`
}

// AddFundsResponse is returned after successfully adding funds to a month.
// It includes the refreshed month summary (with the updated allowance_added
// and ending_balance) and the new overall total balance.
type AddFundsResponse struct {
	Success      bool          `json:"success"`
	Summary      *MonthSummary `json:"summary"`
	TotalBalance float64       `json:"total_balance"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

type SuccessResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
}
