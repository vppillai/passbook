/**
 * Example Lambda Function for Sending Password Reset Emails
 * 
 * This function retrieves the SMTP password from AWS Secrets Manager
 * and sends password reset emails using nodemailer.
 * 
 * Deployment:
 * 1. Package this function with nodemailer dependency
 * 2. Deploy to Lambda with the execution role from CloudFormation
 * 3. Set environment variable: ZOHO_SMTP_SECRET_NAME
 */

const AWS = require('aws-sdk');
const nodemailer = require('nodemailer');

const secretsManager = new AWS.SecretsManager({ region: process.env.AWS_REGION });

/**
 * Retrieve SMTP configuration from Secrets Manager
 */
async function getSmtpConfig() {
  const secretName = process.env.ZOHO_SMTP_SECRET_NAME || 
    `allowance-passbook/${process.env.ENVIRONMENT || 'production'}/zoho-smtp-password`;
  
  try {
    const secret = await secretsManager.getSecretValue({ SecretId: secretName }).promise();
    return JSON.parse(secret.SecretString);
  } catch (error) {
    console.error('Failed to retrieve SMTP secret:', error);
    throw new Error('Failed to retrieve SMTP configuration');
  }
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
      password: config.password,
    },
  });

  const mailOptions = {
    from: config.user,
    to: email,
    subject: 'Password Reset Request - Allowance Passbook',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
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
    `,
    text: `
Allowance Passbook - Password Reset Request

We received a request to reset your password for your ${accountType} account (${email}).

Reset your password by visiting:
${resetUrl}

This link will expire in 1 hour.

If you didn't request this, please ignore this email.
    `,
  };

  return transporter.sendMail(mailOptions);
}

/**
 * Lambda handler
 */
exports.handler = async (event) => {
  console.log('Email send request:', JSON.stringify(event, null, 2));

  try {
    const { to, subject, html, text, resetToken, accountType, baseUrl } = JSON.parse(event.body || '{}');

    if (!to) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required field: to' }),
      };
    }

    // If this is a password reset email
    if (resetToken && accountType && baseUrl) {
      await sendPasswordResetEmail(to, resetToken, accountType, baseUrl);
    } else {
      // Generic email sending
      const config = await getSmtpConfig();
      const transporter = nodemailer.createTransport({
        host: config.host,
        port: parseInt(config.port),
        secure: config.secure === 'true',
        auth: {
          user: config.user,
          password: config.password,
        },
      });

      await transporter.sendMail({
        from: config.user,
        to,
        subject: subject || 'Email from Allowance Passbook',
        html,
        text,
      });
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: JSON.stringify({ 
        message: 'Email sent successfully',
      }),
    };
  } catch (error) {
    console.error('Error sending email:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: JSON.stringify({ 
        error: 'Failed to send email',
        message: error.message,
      }),
    };
  }
};

