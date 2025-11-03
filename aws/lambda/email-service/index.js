/**
 * Lambda Function for Sending Password Reset Emails
 * 
 * This function retrieves the SMTP password from AWS Secrets Manager
 * and sends password reset emails using nodemailer.
 */

const AWS = require('aws-sdk');
const nodemailer = require('nodemailer');

const secretsManager = new AWS.SecretsManager({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Retrieve SMTP configuration from Secrets Manager
 */
async function getSmtpConfig() {
  const secretName = process.env.ZOHO_SMTP_SECRET_NAME ||
    `allowance-passbook/${process.env.ENVIRONMENT || 'production'}/zoho-smtp-password`;

  try {
    const secret = await secretsManager.getSecretValue({ SecretId: secretName }).promise();
    const config = JSON.parse(secret.SecretString);
    return config;
  } catch (error) {
    console.error('Failed to retrieve SMTP secret:', error);
    throw new Error(`Failed to retrieve SMTP configuration: ${error.message}`);
  }
}

/**
 * Generate password reset email HTML
 */
function generatePasswordResetEmailHtml(email, resetUrl, accountType) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 20px auto; padding: 0; }
    .header { background-color: #0ea5e9; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background-color: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .button { display: inline-block; padding: 12px 24px; background-color: #0ea5e9; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
    .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
    .warning { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Allowance Passbook</h1>
    </div>
    <div class="content">
      <h2>Password Reset Request</h2>
      <p>Hello,</p>
      <p>We received a request to reset your password for your ${accountType} account (${email}).</p>
      <p>Click the button below to reset your password:</p>
      <p style="text-align: center;">
        <a href="${resetUrl}" class="button">Reset Password</a>
      </p>
      <p>Or copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #0ea5e9;">${resetUrl}</p>
      <div class="warning">
        <strong>⚠️ Security Notice:</strong>
        <ul>
          <li>This link will expire in 1 hour</li>
          <li>If you didn't request this, please ignore this email</li>
          <li>Never share your reset link with anyone</li>
        </ul>
      </div>
    </div>
    <div class="footer">
      <p>This is an automated email from Allowance Passbook.</p>
      <p>Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Send password reset email
 */
async function sendPasswordResetEmail(email, resetToken, accountType, baseUrl) {
  const config = await getSmtpConfig();
  
  const resetUrl = `${baseUrl}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}&type=${accountType}`;

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: parseInt(config.port),
    secure: config.secure === 'true',
    auth: {
      user: config.user,
      pass: config.password,
    },
  });

  const html = generatePasswordResetEmailHtml(email, resetUrl, accountType);
  const text = `Allowance Passbook - Password Reset Request

We received a request to reset your password for your ${accountType} account (${email}).

Reset your password by visiting:
${resetUrl}

This link will expire in 1 hour.

If you didn't request this, please ignore this email.
`;

  return transporter.sendMail({
    from: `"Allowance Passbook" <${config.user}>`,
    to: email,
    subject: 'Password Reset Request - Allowance Passbook',
    html,
    text,
  });
}

/**
 * Send generic email
 */
async function sendGenericEmail(to, subject, html, text) {
  const config = await getSmtpConfig();
  
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: parseInt(config.port),
    secure: config.secure === 'true',
    auth: {
      user: config.user,
      pass: config.password,
    },
  });

  return transporter.sendMail({
    from: `"Allowance Passbook" <${config.user}>`,
    to,
    subject: subject || 'Email from Allowance Passbook',
    html,
    text,
  });
}

/**
 * Lambda handler
 */
exports.handler = async (event) => {

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
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
    const { to, subject, html, text, resetToken, accountType, baseUrl } = body;

    if (!to) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing required field: to' }),
      };
    }

    // If this is a password reset email
    if (resetToken && accountType) {
      const defaultBaseUrl = baseUrl || 'https://vppillai.github.io/passbook';
      await sendPasswordResetEmail(to, resetToken, accountType, defaultBaseUrl);
    } else {
      // Generic email sending
      if (!subject && !html && !text) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Missing email content (subject, html, or text)' }),
        };
      }
      await sendGenericEmail(to, subject, html, text);
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: 'Email sent successfully',
      }),
    };
  } catch (error) {
    console.error('Error sending email:', error);
    
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Failed to send email',
        message: error.message,
      }),
    };
  }
};

