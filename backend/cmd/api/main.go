package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/vppillai/passbook/backend/internal/handler"
	"github.com/vppillai/passbook/backend/internal/repository"
	"github.com/vppillai/passbook/backend/internal/service"
)

var router *handler.Router

func init() {
	// Load configuration
	tableName := os.Getenv("TABLE_NAME")
	if tableName == "" {
		log.Fatal("TABLE_NAME environment variable is required")
	}

	allowedOrigin := os.Getenv("ALLOWED_ORIGIN")
	if allowedOrigin == "" {
		allowedOrigin = "https://vppillai.github.io"
	}

	monthlyAllowance := 100.0
	if val := os.Getenv("MONTHLY_ALLOWANCE"); val != "" {
		if parsed, err := strconv.ParseFloat(val, 64); err == nil {
			monthlyAllowance = parsed
		}
	}

	// Initialize AWS SDK
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}

	// Create DynamoDB client
	dynamoClient := dynamodb.NewFromConfig(cfg)

	// Create repository
	repo := repository.NewRepository(dynamoClient, tableName)

	// Create services
	authService := service.NewAuthService(repo)
	expenseService := service.NewExpenseService(repo, monthlyAllowance)

	// Create router
	router = handler.NewRouter(authService, expenseService, allowedOrigin)
}

func handleRequest(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
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
	req, err := http.NewRequestWithContext(ctx, event.RequestContext.HTTP.Method, event.RawPath, nil)
	if err != nil {
		return nil, err
	}

	// Set query parameters
	req.URL.RawQuery = event.RawQueryString

	// Set headers
	for k, v := range event.Headers {
		req.Header.Set(k, v)
	}

	// Set body
	if event.Body != "" {
		req.Body = &bodyReader{data: []byte(event.Body)}
	}

	return req, nil
}

type bodyReader struct {
	data []byte
	pos  int
}

func (b *bodyReader) Read(p []byte) (n int, err error) {
	if b.pos >= len(b.data) {
		return 0, nil
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
