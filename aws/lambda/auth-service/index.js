/**
 * Lambda Function for Authentication Service
 * 
 * This function handles:
 * - User login with email/password validation
 * - JWT token generation
 * - Token validation
 * 
 * Password validation happens server-side against DynamoDB for security.
 */

const AWS = require('aws-sdk');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const dynamodb = new AWS.DynamoDB.DocumentClient({ region: process.env.AWS_REGION || 'us-east-1' });

const PARENT_ACCOUNTS_TABLE = process.env.PARENT_ACCOUNTS_TABLE || 
  `allowance-passbook-${process.env.ENVIRONMENT || 'production'}-parent-accounts`;
const CHILD_ACCOUNTS_TABLE = process.env.CHILD_ACCOUNTS_TABLE || 
  `allowance-passbook-${process.env.ENVIRONMENT || 'production'}-child-accounts`;

// JWT secret - in production, should be stored in Secrets Manager
let JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRATION = process.env.JWT_EXPIRATION || '15m'; // 15 minutes

/**
 * Get JWT secret from Secrets Manager (if configured)
 */
async function getJwtSecret() {
  const secretName = process.env.JWT_SECRET_NAME;
  if (!secretName) {
    return JWT_SECRET;
  }

  try {
    const secretsManager = new AWS.SecretsManager({ region: process.env.AWS_REGION || 'us-east-1' });
    const secret = await secretsManager.getSecretValue({ SecretId: secretName }).promise();
    const config = JSON.parse(secret.SecretString);
    return config.secret || JWT_SECRET;
  } catch (error) {
    console.error('Failed to retrieve JWT secret, using default:', error);
    return JWT_SECRET;
  }
}

/**
 * Initialize JWT secret (load from Secrets Manager if configured)
 */
let jwtSecretInitialized = false;
async function initializeJwtSecret() {
  if (jwtSecretInitialized) return;
  
  const secretName = process.env.JWT_SECRET_NAME;
  if (secretName) {
    try {
      const secretsManager = new AWS.SecretsManager({ region: process.env.AWS_REGION || 'us-east-1' });
      const secret = await secretsManager.getSecretValue({ SecretId: secretName }).promise();
      const config = JSON.parse(secret.SecretString);
      JWT_SECRET = config.secret || JWT_SECRET;
    } catch (error) {
      console.error('Failed to retrieve JWT secret from Secrets Manager, using environment variable:', error);
    }
  }
  jwtSecretInitialized = true;
}

/**
 * Generate JWT token for authenticated user
 */
async function generateToken(userId, email, userType, name) {
  await initializeJwtSecret();
  
  const payload = {
    userId,
    email,
    userType,
    name,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (15 * 60), // 15 minutes
  };

  return jwt.sign(payload, JWT_SECRET);
}

/**
 * Validate JWT token
 */
async function validateToken(token) {
  await initializeJwtSecret();
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return {
      valid: true,
      userId: decoded.userId,
      email: decoded.email,
      userType: decoded.userType,
      name: decoded.name,
    };
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return { valid: false, error: 'Token has expired' };
    } else if (error.name === 'JsonWebTokenError') {
      return { valid: false, error: 'Invalid token' };
    }
    return { valid: false, error: 'Token validation failed' };
  }
}

/**
 * Verify password against hash
 */
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Get parent account by email
 */
async function getParentAccountByEmail(email) {
  try {
    const result = await dynamodb.query({
      TableName: PARENT_ACCOUNTS_TABLE,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: {
        ':email': email.trim().toLowerCase(),
      },
      Limit: 1,
    }).promise();

    return result.Items && result.Items.length > 0 ? result.Items[0] : null;
  } catch (error) {
    console.error('Error querying parent account:', error);
    throw new Error('Failed to query parent account');
  }
}

/**
 * Get child account by email
 */
async function getChildAccountByEmail(email) {
  try {
    const result = await dynamodb.query({
      TableName: CHILD_ACCOUNTS_TABLE,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: {
        ':email': email.trim().toLowerCase(),
      },
      Limit: 1,
    }).promise();

    return result.Items && result.Items.length > 0 ? result.Items[0] : null;
  } catch (error) {
    console.error('Error querying child account:', error);
    throw new Error('Failed to query child account');
  }
}

/**
 * Handle login request
 */
async function handleLogin(body) {
  const { email, password, userType } = body;

  if (!email || !password) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Email and password are required' }),
    };
  }

  try {
    let account;
    if (userType === 'parent') {
      account = await getParentAccountByEmail(email);
    } else {
      account = await getChildAccountByEmail(email);
    }

    if (!account) {
      // Return generic error to prevent email enumeration
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid email or password' }),
      };
    }

    // Check if account is active (for child accounts)
    if (userType === 'child' && !account.isActive) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: 'Account is inactive' }),
      };
    }

    // Verify password server-side
    const isValid = await verifyPassword(password, account.passwordHash);
    if (!isValid) {
      // Return generic error to prevent email enumeration
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid email or password' }),
      };
    }

    // Generate JWT token
    const token = await generateToken(
      account.id,
      account.email,
      userType,
      account.name
    );

    // Return token and user info
    return {
      statusCode: 200,
      body: JSON.stringify({
        token,
        userId: account.id,
        email: account.email,
        userType,
        name: account.name,
        theme: account.theme || 'system',
        passwordChangedAt: account.passwordChangedAt || account.createdAt,
      }),
    };
  } catch (error) {
    console.error('Login error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

/**
 * Handle token validation request
 */
async function handleValidateToken(body) {
  const { token } = body;

  if (!token) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Token is required' }),
    };
  }

  const validation = await validateToken(token);

  if (!validation.valid) {
    return {
      statusCode: 401,
      body: JSON.stringify({
        valid: false,
        error: validation.error,
      }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      valid: true,
      userId: validation.userId,
      email: validation.email,
      userType: validation.userType,
      name: validation.name,
    }),
  };
}

/**
 * Lambda handler
 */
exports.handler = async (event) => {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'POST,OPTIONS,GET',
  };

  // Handle OPTIONS request for CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }

  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const path = event.path || event.resource || '';
    const method = event.httpMethod;

    // Route based on path and method
    if (path.includes('/login') && method === 'POST') {
      const response = await handleLogin(body);
      return {
        ...response,
        headers: corsHeaders,
      };
    }

    if (path.includes('/validate') && method === 'POST') {
      const response = await handleValidateToken(body);
      return {
        ...response,
        headers: corsHeaders,
      };
    }

    // Unknown route
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

