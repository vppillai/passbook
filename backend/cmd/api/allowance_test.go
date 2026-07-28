package main

import "testing"

// strconv.ParseFloat accepts more than this config can use: "NaN", "Inf",
// "+Inf" and "-Inf" all parse without error. A NaN allowance would be written
// into every month's allowance_added and ending_balance, and DynamoDB's number
// type has no NaN — the marshalled "NaN" is rejected — so a single typo in one
// CloudFormation parameter would make every month create and every top-up fail,
// with the cause nowhere near the symptom. A negative allowance is wrong more
// quietly: it debits the balance every month and looks like a data bug.
func TestParseMonthlyAllowance(t *testing.T) {
	const fallback = 100.0
	tests := []struct {
		name string
		in   string
		want float64
	}{
		{"absent falls back", "", fallback},
		{"ordinary value", "250", 250},
		{"cents", "12.50", 12.50},
		{"zero is legitimate", "0", 0},
		{"garbage falls back", "abc", fallback},
		{"NaN falls back", "NaN", fallback},
		{"lowercase nan falls back", "nan", fallback},
		{"Inf falls back", "Inf", fallback},
		{"+Inf falls back", "+Inf", fallback},
		{"-Inf falls back", "-Inf", fallback},
		{"infinity spelled out falls back", "infinity", fallback},
		{"negative falls back", "-50", fallback},
		{"whitespace is not a number", " 100 ", fallback},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := parseMonthlyAllowance(tc.in, fallback); got != tc.want {
				t.Errorf("parseMonthlyAllowance(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}
