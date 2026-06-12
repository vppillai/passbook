package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
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

var (
	router    *handler.Router
	setupOnce sync.Once
	setupErr  error
)

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

	monthlyAllowance := 100.0
	if val := os.Getenv("MONTHLY_ALLOWANCE"); val != "" {
		if parsed, err := strconv.ParseFloat(val, 64); err == nil {
			monthlyAllowance = parsed
		} else {
			// Don't fail the cold start over a bad config value, but make
			// the silent $100 fallback visible in the logs so an operator
			// who fat-fingered the param can find out why.
			log.Printf("warn: MONTHLY_ALLOWANCE=%q is not a valid number, falling back to %.2f: %v", val, monthlyAllowance, err)
		}
	}

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
	// Lazy init on first invocation. Errors become 500 instead of a
	// process-killing log.Fatal — Lambda will then retry the cold start.
	setupOnce.Do(func() { setupErr = setupRouter() })
	if setupErr != nil {
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusInternalServerError,
			Body:       `{"error":"Service initialization failed"}`,
			Headers:    map[string]string{"Content-Type": "application/json"},
		}, nil
	}

	// Reject oversized request bodies (32 KB limit)
	if len(event.Body) > 32*1024 {
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusRequestEntityTooLarge,
			Body:       `{"error":"Request body too large"}`,
			Headers:    map[string]string{"Content-Type": "application/json"},
		}, nil
	}

	// Convert API Gateway event to http.Request
	req, err := convertToHTTPRequest(ctx, event)
	if err != nil {
		return events.APIGatewayV2HTTPResponse{
			StatusCode: http.StatusInternalServerError,
			Body:       `{"error":"Failed to process request"}`,
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

	// Always set a non-nil body. decodeStrict and any future handler
	// using json.NewDecoder(r.Body) would crash on a nil body —
	// guard at the boundary instead of in every handler.
	req.Body = &bodyReader{data: []byte(event.Body)}

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
