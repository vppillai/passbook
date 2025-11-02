# Email Service - Password Reset

This directory contains the email service for sending password reset emails.

## Setup

### Zoho Mail Configuration

1. Log in to your Zoho Mail account
2. Go to **Settings** → **Mail** → **POP/IMAP Access**
3. Enable **IMAP Access** or **SMTP Access**
4. Generate an **App Password** (not your regular password):
   - Go to **Security** → **App Passwords**
   - Create a new app password for "Mail Client"
   - Save this password - you'll need it for the `ZOHO_SMTP_PASSWORD` environment variable

### SMTP Settings

- **Host**: `smtp.zoho.in`
- **Port**: `587` (TLS) or `465` (SSL)
- **From Email**: `support@embeddedinn.com`
- **Authentication**: Required (use app password, not regular password)

**Note**: Make sure you're using the correct server:
- For `.in` domains: `smtp.zoho.in`
- For other domains: `smtp.zoho.com`

## Testing SMTP Locally

### Prerequisites

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set environment variable:
   ```bash
   export ZOHO_SMTP_PASSWORD="your-zoho-app-password"
   ```

   Or create a `.env` file in the `frontend` directory:
   ```
   ZOHO_SMTP_PASSWORD=your-zoho-app-password
   TEST_EMAIL=your-test-email@example.com
   ```

### Run Test

```bash
cd frontend
npm run test:smtp
```

This will:
1. ✅ Verify SMTP connection
2. 📧 Send a test email to verify email sending works
3. 🔍 Show any configuration errors

### Expected Output

```
🔍 Testing Zoho SMTP Configuration...

Configuration:
  Host: smtp.zoho.in
  Port: 587 (TLS)
  User: support@embeddedinn.com
  Authentication: Required
  Password: ************

📡 Connecting to SMTP server...
🔐 Verifying connection...
✅ SMTP connection verified successfully!

📧 Sending test email...
✅ Test email sent successfully!
   Message ID: <...>
   Sent to: your-test-email@example.com

🎉 All tests passed! SMTP is configured correctly.

You can now proceed with deploying to AWS.
```

## Troubleshooting

### Authentication Failed (EAUTH)

- Verify you're using an **App Password**, not your regular Zoho password
- Check that SMTP access is enabled in Zoho Mail settings
- Ensure the email `support@embeddedinn.com` exists and is active

### Connection Failed (ETIMEDOUT / ECONNREFUSED)

- Check firewall settings
- Verify network connectivity
- Confirm SMTP host (`smtp.zoho.in`) and port (`587` for TLS or `465` for SSL) are correct
- Try port `465` with `secure: true` if port `587` doesn't work
- For `.in` domains, make sure you're using `smtp.zoho.in`, not `smtp.zoho.com`

### Email Not Received

- Check spam/junk folder
- Verify the recipient email address
- Wait a few minutes (email delivery can be delayed)
- Check Zoho Mail logs (if available)

## Production Deployment (AWS)

For production, you have two options:

### Option 1: AWS SES (Recommended)

1. Set up AWS SES
2. Verify the `support@embeddedinn.com` domain
3. Create a Lambda function that uses AWS SES SDK
4. Update the email service to call the Lambda function

### Option 2: Keep Zoho SMTP (via Lambda)

1. Create a Lambda function that uses nodemailer
2. Store `ZOHO_SMTP_PASSWORD` in AWS Secrets Manager
3. Update the frontend to call the Lambda endpoint
4. The Lambda function will handle email sending using Zoho SMTP

## Security Notes

⚠️ **Never commit passwords or secrets to git!**

- Use environment variables for passwords
- Use AWS Secrets Manager in production
- Rotate passwords regularly
- Use App Passwords, not regular account passwords

## Files

- `email.service.ts` - Email service implementation
- `test-smtp.js` - SMTP testing script
- `README.md` - This file

