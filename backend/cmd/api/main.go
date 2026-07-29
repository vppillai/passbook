package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"sync"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/vppillai/passbook/backend/internal/handler"
	"github.com/vppillai/passbook/backend/internal/repository"
	"github.com/vppillai/passbook/backend/internal/service"
)

// maxBodyBytes caps the DECODED request body. Every endpoint here takes a
// small JSON object, so this is generous.
const maxBodyBytes = 32 * 1024

// errBadBase64Body marks a body that API Gateway flagged as base64-encoded but
// which does not decode. That is a client-side fault, so handleRequest maps it
// to 400 rather than 500.
var errBadBase64Body = errors.New("request body is not valid base64")

// decodedTooLarge reports whether a decoded body exceeds the cap.
func decodedTooLarge(n int64) bool { return n > maxBodyBytes }

var (
	router    *handler.Router
	setupOnce sync.Once
	setupErr  error
)

// defaultMonthlyAllowance is used when MONTHLY_ALLOWANCE is absent or unusable.
const defaultMonthlyAllowance = 100.0

// parseMonthlyAllowance reads the MONTHLY_ALLOWANCE value, falling back to
// `fallback` for anything it cannot use.
//
// strconv.ParseFloat is more permissive than this config wants: it accepts
// "NaN", "Inf", "+Inf" and "-Inf" without error. A NaN allowance would be
// written into every month's allowance_added and ending_balance, and since
// DynamoDB has no NaN in its number type the marshalled "NaN" is rejected —
// so every month create and every top-up would fail, from one typo, with the
// cause nowhere near the symptom. A negative allowance is just as wrong in a
// quieter way: it silently debits the balance each month.
//
// A bad value still does not fail the cold start — the deployment would be
// wholly unavailable rather than merely misconfigured — but the fallback is
// logged loudly enough that an operator can find out why.
func parseMonthlyAllowance(val string, fallback float64) float64 {
	if val == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(val, 64)
	if err != nil {
		log.Printf("warn: MONTHLY_ALLOWANCE=%q is not a valid number, falling back to %.2f: %v",
			val, fallback, err)
		return fallback
	}
	if math.IsNaN(parsed) || math.IsInf(parsed, 0) {
		log.Printf("warn: MONTHLY_ALLOWANCE=%q is not a finite number, falling back to %.2f",
			val, fallback)
		return fallback
	}
	if parsed < 0 {
		log.Printf("warn: MONTHLY_ALLOWANCE=%q is negative, falling back to %.2f", val, fallback)
		return fallback
	}
	return parsed
}

// setupRouter constructs the router on first call. Previously this lived
// in init(), which called log.Fatal on missing env vars or AWS config
// failure — that's a process-killing crash on cold start AND makes the
// package impossible to import in tests without setting every env var.
// Now: lazy + returns errors; handleRequest converts an init failure
// into a 500 response instead of crashing the function.
func setupRouter() error {
	tableName := os.Getenv("TABLE_NAME")
	if tableName == "" {
		return errors.New("TABLE_NAME environment variable is required")
	}

	allowedOrigin := os.Getenv("ALLOWED_ORIGIN")
	if allowedOrigin == "" {
		return errors.New("ALLOWED_ORIGIN environment variable is required")
	}

	monthlyAllowance := parseMonthlyAllowance(os.Getenv("MONTHLY_ALLOWANCE"), defaultMonthlyAllowance)

	allowOverspending := false
	if val := os.Getenv("ALLOW_OVERSPENDING"); val == "true" {
		allowOverspending = true
	}

	carryOverBalance := true
	if val := os.Getenv("CARRY_OVER_BALANCE"); val == "false" {
		carryOverBalance = false
	}

	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		return fmt.Errorf("failed to load AWS config: %w", err)
	}

	dynamoClient := dynamodb.NewFromConfig(cfg)
	repo := repository.NewRepository(dynamoClient, tableName)
	authService := service.NewAuthService(repo)
	expenseService := service.NewExpenseService(repo, monthlyAllowance, allowOverspending, carryOverBalance)

	// WebAuthn (biometric unlock): RP ID is derived from ALLOWED_ORIGIN's
	// host, RP origin is ALLOWED_ORIGIN, display name from
	// WEBAUTHN_RP_DISPLAY_NAME or the constant "Passbook". A config failure
	// (e.g. unparsable origin) is logged but never fails the cold start —
	// the router treats a nil service as "WebAuthn unavailable" and PIN auth
	// keeps working.
	webauthnService, err := service.NewWebAuthnService(repo, allowedOrigin, os.Getenv("WEBAUTHN_RP_DISPLAY_NAME"))
	if err != nil {
		log.Printf("warn: WebAuthn disabled (config error): %v", err)
		webauthnService = nil
	}

	router = handler.NewRouter(authService, expenseService, webauthnService, allowedOrigin)
	return nil
}

func handleRequest(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	// Body validation runs BEFORE router construction. It needs nothing from
	// the router, and rejecting an oversized or undecodable body without first
	// building a DynamoDB client and an Argon2-capable service is both cheaper
	// and independently testable — handleRequest previously could not be
	// exercised at all without a full environment, which is why its status
	// mapping had no coverage.

	// Cheap pre-filter on the wire size, before spending anything on decoding.
	// base64 inflates by about a third, so this bound is deliberately loose;
	// the real limit is enforced on the DECODED body below.
	if len(event.Body) > 2*maxBodyBytes {
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusRequestEntityTooLarge,
			Body:       `{"error":"Request body too large"}`,
			Headers:    map[string]string{"Content-Type": "application/json"},
		}, nil
	}

	// Convert API Gateway event to http.Request
	req, err := convertToHTTPRequest(ctx, event)
	if err != nil {
		// A body flagged base64 that does not decode is the client's problem,
		// not ours — reporting 500 would blame the server for a malformed
		// request. Anything else here is genuinely internal.
		if errors.Is(err, errBadBase64Body) {
			return events.APIGatewayV2HTTPResponse{
				StatusCode: http.StatusBadRequest,
				Body:       `{"error":"Invalid request body encoding"}`,
				Headers:    map[string]string{"Content-Type": "application/json"},
			}, nil
		}
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusInternalServerError,
			Body:       `{"error":"Failed to process request"}`,
			Headers:    map[string]string{"Content-Type": "application/json"},
		}, nil
	}

	// Enforce the real limit on the decoded body.
	if decodedTooLarge(req.ContentLength) {
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusRequestEntityTooLarge,
			Body:       `{"error":"Request body too large"}`,
			Headers:    map[string]string{"Content-Type": "application/json"},
		}, nil
	}

	// Lazy init on first invocation. Errors become 500 instead of a
	// process-killing log.Fatal — Lambda will then retry the cold start.
	setupOnce.Do(func() { setupErr = setupRouter() })
	if setupErr != nil {
		// Log it: the error is memoized for the life of the container, so
		// without this every subsequent 500 is indistinguishable from any other
		// and the actual cause (a missing env var, an unusable AWS config) is
		// never recorded anywhere.
		log.Printf("error: router initialization failed: %v", setupErr)
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusInternalServerError,
			Body:       `{"error":"Service initialization failed"}`,
			Headers:    map[string]string{"Content-Type": "application/json"},
		}, nil
	}

	// Create response writer
	rw := &responseWriter{
		headers: make(http.Header),
	}

	// Handle request
	router.ServeHTTP(rw, req)

	// Convert response
	return events.APIGatewayV2HTTPResponse{
		StatusCode: rw.statusCode,
		Body:       rw.body,
		Headers:    flattenHeaders(rw.headers),
	}, nil
}

func convertToHTTPRequest(ctx context.Context, event events.APIGatewayV2HTTPRequest) (*http.Request, error) {
	// Create request with a placeholder path first
	req, err := http.NewRequestWithContext(ctx, event.RequestContext.HTTP.Method, "/", nil)
	if err != nil {
		return nil, err
	}

	// APIGW HTTP API v2 delivers RawPath still percent-encoded (e.g. the
	// frontend's encodeURIComponent turns "EXP#..." into "EXP%23..."). We
	// must decode it before assigning to URL.Path — otherwise the literal
	// "%23" reaches the handler's EXP# prefix check and every expense
	// PUT/DELETE 400s in prod. We set Path directly (not via url.Parse)
	// so a '#' in the decoded value isn't treated as a fragment.
	decodedPath, decErr := url.PathUnescape(event.RawPath)
	if decErr != nil {
		// Malformed escaping — fall back to the raw value rather than
		// failing the request outright.
		decodedPath = event.RawPath
	}
	req.URL.Path = decodedPath
	req.URL.RawQuery = event.RawQueryString

	// Set headers
	for k, v := range event.Headers {
		req.Header.Set(k, v)
	}

	// Authoritatively set the source IP from the APIGW request context AFTER
	// copying user-supplied headers, so a malicious client cannot forge it.
	// Handlers read this via handler.SourceIPHeader to scope rate-limiting
	// per client.
	req.Header.Set("X-Source-Ip", event.RequestContext.HTTP.SourceIP)

	// Decode the body when API Gateway base64-encoded it. It makes that
	// decision from the request's Content-Type, not from the actual content,
	// so a client posting valid JSON under a non-text content type arrives
	// base64-encoded. Ignoring the flag fed that straight to json.Decoder and
	// produced an opaque 400 the caller could not act on.
	body := []byte(event.Body)
	if event.IsBase64Encoded {
		decoded, derr := base64.StdEncoding.DecodeString(event.Body)
		if derr != nil {
			return nil, fmt.Errorf("%w: %v", errBadBase64Body, derr)
		}
		body = decoded
	}

	// Always set a non-nil body. decodeStrict and any future handler
	// using json.NewDecoder(r.Body) would crash on a nil body —
	// guard at the boundary instead of in every handler.
	req.Body = &bodyReader{data: body}
	// ContentLength lets handleRequest enforce the size cap on the DECODED
	// bytes rather than the encoded wire form.
	req.ContentLength = int64(len(body))

	return req, nil
}

type bodyReader struct {
	data []byte
	pos  int
}

func (b *bodyReader) Read(p []byte) (n int, err error) {
	if b.pos >= len(b.data) {
		// Must return io.EOF at end-of-data (per io.Reader contract).
		// Returning (0, nil) was tolerated by json.Decoder.Decode but
		// causes json.Decoder.More() — added in PR-6's decodeStrict
		// helper — to loop forever in refill(), hanging the Lambda
		// until the 10s timeout.
		return 0, io.EOF
	}
	n = copy(p, b.data[b.pos:])
	b.pos += n
	return n, nil
}

func (b *bodyReader) Close() error {
	return nil
}

type responseWriter struct {
	statusCode int
	body       string
	headers    http.Header
}

func (rw *responseWriter) Header() http.Header {
	return rw.headers
}

func (rw *responseWriter) Write(data []byte) (int, error) {
	if rw.statusCode == 0 {
		rw.statusCode = http.StatusOK
	}
	rw.body += string(data)
	return len(data), nil
}

func (rw *responseWriter) WriteHeader(statusCode int) {
	rw.statusCode = statusCode
}

func flattenHeaders(h http.Header) map[string]string {
	flat := make(map[string]string)
	for k, v := range h {
		if len(v) > 0 {
			flat[k] = v[0]
		}
	}
	return flat
}

func main() {
	lambda.Start(handleRequest)
}
