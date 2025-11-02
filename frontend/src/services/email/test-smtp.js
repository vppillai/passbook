/**
 * SMTP Test Script
 * 
 * Run this script locally to test Zoho SMTP configuration before deploying to AWS
 * 
 * Usage:
 *   cd frontend
 *   npm run test:smtp
 * 
 * Make sure to set ZOHO_SMTP_PASSWORD environment variable:
 *   export ZOHO_SMTP_PASSWORD="your-zoho-password"
 * 
 * Or create a .env file in the frontend directory
 */

import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env file if it exists
// Look for .env in the frontend directory (parent of src/services/email)
dotenv.config({ path: join(__dirname, '../../.env') });

const ZOHO_SMTP_CONFIG = {
  host: 'smtp.zoho.in',
  port: 587, // TLS port (use 465 for SSL)
  secure: false, // true for 465 (SSL), false for 587 (TLS)
  auth: {
    user: 'support@embeddedinn.com',
    password: process.env.ZOHO_SMTP_PASSWORD || '',
  },
};

async function testSMTP() {
  console.log('🔍 Testing Zoho SMTP Configuration...\n');

  if (!ZOHO_SMTP_CONFIG.auth.password) {
    console.error('❌ Error: ZOHO_SMTP_PASSWORD environment variable is not set');
    console.log('\nTo set it, run:');
    console.log('  export ZOHO_SMTP_PASSWORD="your-zoho-password"');
    console.log('\nOr create a .env file with:');
    console.log('  ZOHO_SMTP_PASSWORD=your-zoho-password');
    process.exit(1);
  }

  console.log('Configuration:');
  console.log(`  Host: ${ZOHO_SMTP_CONFIG.host}`);
  console.log(`  Port: ${ZOHO_SMTP_CONFIG.port} (${ZOHO_SMTP_CONFIG.secure ? 'SSL' : 'TLS'})`);
  console.log(`  User: ${ZOHO_SMTP_CONFIG.auth.user}`);
  console.log(`  Password: ${'*'.repeat(ZOHO_SMTP_CONFIG.auth.password.length)}`);
  console.log(`  Authentication: Required\n`);

  try {
    console.log('📡 Connecting to SMTP server...');
    const transporter = nodemailer.createTransport({
      host: ZOHO_SMTP_CONFIG.host,
      port: ZOHO_SMTP_CONFIG.port,
      secure: ZOHO_SMTP_CONFIG.secure,
      auth: ZOHO_SMTP_CONFIG.auth,
    });

    console.log('🔐 Verifying connection...');
    await transporter.verify();
    console.log('✅ SMTP connection verified successfully!\n');

    console.log('📧 Sending test email...');
    const testEmail = process.env.TEST_EMAIL || 'support@embeddedinn.com';
    
    const info = await transporter.sendMail({
      from: 'support@embeddedinn.com',
      to: testEmail,
      subject: 'Test Email - Allowance Passbook SMTP',
      html: `
        <h1>SMTP Test Successful!</h1>
        <p>This is a test email from Allowance Passbook email service.</p>
        <p>If you received this, your SMTP configuration is working correctly.</p>
        <p><strong>Configuration:</strong></p>
        <ul>
          <li>Host: ${ZOHO_SMTP_CONFIG.host}</li>
          <li>Port: ${ZOHO_SMTP_CONFIG.port}</li>
          <li>From: support@embeddedinn.com</li>
        </ul>
      `,
      text: 'SMTP Test Successful! This is a test email from Allowance Passbook email service.',
    });

    console.log('✅ Test email sent successfully!');
    console.log(`   Message ID: ${info.messageId}`);
    console.log(`   Sent to: ${testEmail}\n`);
    console.log('🎉 All tests passed! SMTP is configured correctly.\n');
    console.log('You can now proceed with deploying to AWS.\n');

  } catch (error) {
    console.error('❌ SMTP test failed:\n');
    if (error.code === 'EAUTH') {
      console.error('   Authentication failed. Please check:');
      console.error('   - Email: support@embeddedinn.com');
      console.error('   - Password: Make sure ZOHO_SMTP_PASSWORD is correct');
      console.error('   - Make sure you have enabled SMTP access in Zoho Mail settings');
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
      console.error('   Connection failed. Please check:');
      console.error('   - Network connectivity');
      console.error('   - Firewall settings');
      console.error('   - SMTP host and port (smtp.zoho.in:587 for TLS or :465 for SSL)');
    } else {
      console.error('   Error:', error.message);
      console.error('   Full error:', error);
    }
    process.exit(1);
  }
}

testSMTP();

