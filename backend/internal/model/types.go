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

type MonthDataResponse struct {
	Month        string         `json:"month"`
	Summary      *MonthSummary  `json:"summary"`
	Expenses     []ExpenseItem  `json:"expenses"`
	TotalBalance float64        `json:"total_balance"`
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

type MonthsResponse struct {
	Months []MonthListItem `json:"months"`
}

type BalanceResponse struct {
	TotalBalance float64 `json:"total_balance"`
}

type SetupStatusResponse struct {
	IsSetup bool `json:"is_setup"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

type SuccessResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
}
