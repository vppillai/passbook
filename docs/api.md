# Passbook API Documentation

Complete API reference for the Passbook backend. This document is auto-generated from the OpenAPI specification.

## Base URL

- **Production**: `https://api.passbook.app/v1`
- **Staging**: `https://staging-api.passbook.app/v1`
- **Development**: `https://YOUR-API-ID.execute-api.us-west-2.amazonaws.com/development`

## Authentication

The API uses JWT (JSON Web Tokens) for authentication.

### Getting a Token

1. **Sign up**: `POST /auth/signup`
2. **Verify email**: `POST /auth/verify-email`
3. **Login**: `POST /auth/login`

### Using the Token

Include the JWT token in the `Authorization` header:

```
Authorization: Bearer <your-jwt-token>
```

Tokens expire after **15 minutes**. You'll need to log in again to get a new token.

## Endpoints

### Authentication

#### POST /auth/signup

Create a new parent account.

**Request**:
```json
{
  "email": "parent@example.com",
  "password": "SecurePassword123!",
  "displayName": "John Doe"
}
```

**Response** (201 Created):
```json
{
  "message": "Account created. Please check your email to verify your account.",
  "userId": "usr_abc123xyz",
  "email": "parent@example.com"
}
```

**Errors**:
- `400`: Missing required fields or invalid format
- `409`: Email already registered

---

#### POST /auth/verify-email

Verify email address with token from verification email.

**Request**:
```json
{
  "token": "verif_abc123xyz..."
}
```

**Response** (200 OK):
```json
{
  "message": "Email verified successfully",
  "userId": "usr_abc123xyz"
}
```

**Errors**:
- `400`: Invalid or expired token

---

#### POST /auth/login

Login with email/password or username/password (for children).

**Request (Parent)**:
```json
{
  "email": "parent@example.com",
  "password": "SecurePassword123!"
}
```

**Request (Child with username)**:
```json
{
  "username": "johnny",
  "familyId": "fam_xyz789",
  "password": "ChildPassword123!"
}
```

**Response** (200 OK):
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userId": "usr_abc123xyz",
  "userType": "parent",
  "familyId": "fam_xyz789",
  "email": "parent@example.com",
  "displayName": "John Doe"
}
```

**Errors**:
- `400`: Missing credentials
- `401`: Invalid credentials

---

### Family Management

#### POST /families

Create a new family account (requires verified parent account).

**Headers**: `Authorization: Bearer <token>`

**Request**:
```json
{
  "familyName": "The Doe Family",
  "description": "Managing allowances for our kids",
  "currency": "CAD",
  "timezone": "America/Vancouver"
}
```

**Response** (201 Created):
```json
{
  "familyId": "fam_abc123xyz",
  "familyName": "The Doe Family",
  "currency": "CAD",
  "timezone": "America/Vancouver",
  "createdAt": "2025-01-15T10:30:00Z"
}
```

---

### Child Account Management

#### POST /children

Create a new child account.

**Headers**: `Authorization: Bearer <token>`

**Request**:
```json
{
  "username": "johnny",
  "displayName": "Johnny Doe",
  "password": "ChildPassword123!",
  "loginType": "username",
  "initialBalance": 50.00
}
```

**Response** (201 Created):
```json
{
  "childUserId": "child_abc123xyz",
  "username": "johnny",
  "displayName": "Johnny Doe",
  "balance": 50.00,
  "createdAt": "2025-01-15T11:00:00Z"
}
```

---

#### GET /children

List all children in the family.

**Headers**: `Authorization: Bearer <token>`

**Response** (200 OK):
```json
{
  "children": [
    {
      "childUserId": "child_abc123xyz",
      "username": "johnny",
      "displayName": "Johnny Doe",
      "balance": 45.50,
      "status": "active",
      "createdAt": "2025-01-15T11:00:00Z"
    }
  ],
  "count": 1
}
```

---

#### PUT /children/{childId}

Update child account details.

**Headers**: `Authorization: Bearer <token>`

**Request**:
```json
{
  "displayName": "Johnny Smith",
  "status": "active"
}
```

**Response** (200 OK):
```json
{
  "message": "Child account updated successfully",
  "childUserId": "child_abc123xyz"
}
```

---

#### POST /children/{childId}/reset-password

Reset child account password (parent only).

**Headers**: `Authorization: Bearer <token>`

**Request**:
```json
{
  "newPassword": "NewPassword123!"
}
```

**Response** (200 OK):
```json
{
  "message": "Password reset successfully"
}
```

---

### Parent Management

#### POST /parents/invite

Invite another parent to join the family.

**Headers**: `Authorization: Bearer <token>`

**Request**:
```json
{
  "email": "secondparent@example.com",
  "displayName": "Jane Doe"
}
```

**Response** (200 OK):
```json
{
  "message": "Invitation sent successfully",
  "invitationToken": "inv_abc123xyz"
}
```

---

#### GET /parents

List all parents in the family.

**Headers**: `Authorization: Bearer <token>`

**Response** (200 OK):
```json
{
  "parents": [
    {
      "userId": "usr_abc123xyz",
      "email": "parent@example.com",
      "displayName": "John Doe",
      "role": "account_manager",
      "joinedAt": "2025-01-15T10:00:00Z"
    }
  ],
  "count": 1
}
```

---

### Transactions

#### POST /expenses

Add a new expense.

**Headers**: `Authorization: Bearer <token>`

**Request**:
```json
{
  "childUserId": "child_abc123xyz",
  "amount": 5.50,
  "category": "snacks",
  "description": "Ice cream after school",
  "expenseDate": "2025-01-15"
}
```

**Response** (201 Created):
```json
{
  "message": "Expense added successfully",
  "transactionId": "txn_abc123xyz",
  "amount": 5.50,
  "currency": "CAD",
  "newBalance": 40.00,
  "wasOverdraft": false
}
```

**Categories**:
- `snacks`
- `food`
- `games`
- `sports`
- `school`
- `crafts`
- `toys`
- `books`
- `clothes`
- `entertainment`
- `other`

---

#### GET /expenses

List expenses for a child.

**Headers**: `Authorization: Bearer <token>`

**Query Parameters**:
- `childUserId` (required): Child user ID
- `startDate` (optional): Filter from date (YYYY-MM-DD)
- `endDate` (optional): Filter to date (YYYY-MM-DD)
- `limit` (optional): Number of results (default: 50)

**Response** (200 OK):
```json
{
  "expenses": [
    {
      "transactionId": "txn_abc123xyz",
      "amount": 5.50,
      "currency": "CAD",
      "category": "snacks",
      "description": "Ice cream after school",
      "expenseDate": "2025-01-15",
      "balanceAfter": 40.00,
      "recordedBy": "usr_abc123xyz",
      "createdAt": "2025-01-15T15:30:00Z"
    }
  ],
  "count": 1
}
```

---

#### PUT /expenses/{expenseId}

Update an existing expense.

**Headers**: `Authorization: Bearer <token>`

**Request**:
```json
{
  "amount": 6.00,
  "description": "Ice cream and cookie"
}
```

**Response** (200 OK):
```json
{
  "message": "Expense updated successfully",
  "transactionId": "txn_abc123xyz"
}
```

---

#### POST /funds

Add funds to a child account.

**Headers**: `Authorization: Bearer <token>`

**Request**:
```json
{
  "childUserId": "child_abc123xyz",
  "amount": 20.00,
  "reason": "Weekly allowance",
  "nextFundingDate": "2025-01-22"
}
```

**Response** (201 Created):
```json
{
  "message": "Funds added successfully",
  "transactionId": "txn_fund123",
  "amount": 20.00,
  "newBalance": 60.00
}
```

---

### Analytics

#### GET /analytics

Get spending analytics for a child.

**Headers**: `Authorization: Bearer <token>`

**Query Parameters**:
- `childUserId` (required): Child user ID
- `startDate` (optional): Period start date
- `endDate` (optional): Period end date

**Response** (200 OK):
```json
{
  "summary": {
    "totalExpenses": 125.50,
    "totalFundsAdded": 200.00,
    "currentBalance": 74.50,
    "transactionCount": 15
  },
  "categoryBreakdown": [
    {
      "category": "snacks",
      "amount": 45.50,
      "percentage": 36.25,
      "count": 8
    },
    {
      "category": "games",
      "amount": 40.00,
      "percentage": 31.87,
      "count": 3
    }
  ],
  "trendData": [
    {
      "date": "2025-01-15",
      "expenses": 15.50,
      "fundsAdded": 0
    }
  ]
}
```

---

#### POST /reports

Generate and download a report.

**Headers**: `Authorization: Bearer <token>`

**Request**:
```json
{
  "reportType": "pdf",
  "scope": "child",
  "childUserId": "child_abc123xyz",
  "startDate": "2025-01-01",
  "endDate": "2025-01-31"
}
```

**Response** (200 OK):
```json
{
  "reportUrl": "https://s3.amazonaws.com/passbook-reports/report_abc123.pdf",
  "reportId": "rpt_abc123xyz",
  "expiresAt": "2025-01-16T10:00:00Z"
}
```

**Report Types**:
- `pdf`: Professional PDF report
- `excel`: Excel spreadsheet (.xlsx)

**Scope**:
- `child`: Report for a single child
- `family`: Report for entire family

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message here",
  "statusCode": 400,
  "timestamp": "2025-01-15T10:00:00Z"
}
```

### Common Error Codes

- **400 Bad Request**: Invalid input or missing required fields
- **401 Unauthorized**: Missing or invalid authentication token
- **403 Forbidden**: Valid token but insufficient permissions
- **404 Not Found**: Resource doesn't exist
- **409 Conflict**: Resource already exists (e.g., duplicate email)
- **429 Too Many Requests**: Rate limit exceeded
- **500 Internal Server Error**: Server-side error

---

## Rate Limiting

API Gateway enforces the following rate limits:

- **Steady rate**: 100 requests per second
- **Burst capacity**: 200 requests

If you exceed the rate limit, you'll receive a `429 Too Many Requests` response.

---

## Testing the API

### Using curl

```bash
# Signup
curl -X POST https://YOUR-API-URL/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "test@example.com",
    "password": "Test123!",
    "displayName": "Test User"
  }'

# Login
curl -X POST https://YOUR-API-URL/auth/login \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "test@example.com",
    "password": "Test123!"
  }'

# Use token (replace TOKEN with actual token from login)
curl -X GET https://YOUR-API-URL/children \
  -H 'Authorization: Bearer TOKEN'
```

### Using Postman

1. Import the OpenAPI spec from `specs/001-passbook-complete/contracts/openapi.yaml`
2. Set up environment variables:
   - `baseUrl`: Your API URL
   - `token`: JWT token from login
3. Use {{baseUrl}} and {{token}} in requests

---

## For Full API Specification

See `specs/001-passbook-complete/contracts/openapi.yaml` for the complete OpenAPI 3.0 specification with all endpoints, schemas, and examples.
