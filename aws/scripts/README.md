# AWS Deployment Scripts

## update-smtp-secret.sh

Updates the Zoho SMTP password in AWS Secrets Manager.

**Usage:**
```bash
./update-smtp-secret.sh <environment> [password]
```

**Examples:**
```bash
# Update development environment
./update-smtp-secret.sh development

# Update production with specific password
./update-smtp-secret.sh production [REDACTED]
```

## create-smtp-secret.sh

Quick script to create the SMTP secret with the default password.

**Usage:**
```bash
./create-smtp-secret.sh <environment>
```

**Examples:**
```bash
./create-smtp-secret.sh development
./create-smtp-secret.sh production
```

## Notes

- The secret is automatically created by CloudFormation during stack deployment
- You can update it manually using these scripts if needed
- The secret name follows the pattern: `allowance-passbook/{environment}/zoho-smtp-password`
- The secret contains: password, host, port, secure flag, and user email

