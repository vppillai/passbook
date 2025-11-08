# Passbook - Family Allowance Management System

A cross-platform family allowance management application that helps parents teach children financial responsibility through digital allowances and expense tracking.

## Features

- **Multi-Parent Support**: Invite multiple parents with equal account manager rights
- **Child Account Management**: Create and manage child accounts with username or email-based login
- **Fund Management**: Add funds to child accounts with funding period tracking
- **Expense Tracking**: Children can track expenses across 11 categories with overdraft protection
- **Analytics & Reports**: View spending analytics with charts and export PDF/Excel reports
- **Offline Support**: Full offline functionality with automatic sync when online
- **Push Notifications**: Get notified about low balances, new expenses, and fund additions
- **Multi-Platform**: Works on Web (PWA), iOS, and Android from a single codebase

## Tech Stack

- **Frontend**: Pure HTML/CSS/JavaScript web dashboard (no build step required)
- **Backend**: AWS Serverless (Lambda, DynamoDB, API Gateway, SAM)
- **CI/CD**: GitHub Actions for automated deployment
- **Hosting**: GitHub Pages (frontend), AWS (backend)
- **Infrastructure**: AWS SAM (Serverless Application Model)

## Quick Start

### Prerequisites

- AWS Account with admin access
- AWS CLI v2 configured
- SAM CLI installed
- Python 3.11+
- GitHub account
- GitHub CLI (`gh`) - optional but recommended

### Deployment

**For detailed deployment instructions, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**

Quick setup:

1. Clone the repository:
```bash
git clone https://github.com/vppillai/passbook.git
cd passbook
```

2. Set up AWS IAM for GitHub Actions:
```bash
chmod +x scripts/setup-github-actions-iam.sh
./scripts/setup-github-actions-iam.sh
```

3. Configure GitHub Secrets (follow output from step 2)

4. Deploy backend:
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
chmod +x deploy-sam.sh
./deploy-sam.sh development us-west-2
```

5. Push to GitHub to trigger CI/CD:
```bash
git push origin main
```

### Local Development

- **Frontend**: Open `web-dashboard/index.html` in a browser
- **Backend Tests**: 
```bash
cd backend
source venv/bin/activate
pytest tests/
```

## Project Structure

```
passbook/
├── web-dashboard/          # Pure HTML/CSS/JS frontend
│   ├── index.html         # Main HTML file
│   ├── app.js            # Application logic
│   └── styles.css        # Styling
├── backend/               # AWS Lambda backend
│   ├── infrastructure/    # SAM/CloudFormation templates
│   ├── src/              # Lambda function code
│   │   └── lambdas/      # Individual Lambda handlers
│   ├── tests/            # Backend tests
│   └── deploy-sam.sh     # Deployment script
├── scripts/              # Deployment and setup scripts
│   └── setup-github-actions-iam.sh
├── docs/                 # Documentation
│   └── DEPLOYMENT.md     # Detailed deployment guide
└── .github/workflows/    # GitHub Actions CI/CD
    ├── deploy-backend.yml
    └── deploy-frontend.yml
```

## Development

### Accessing the Application

- **Frontend**: https://vppillai.github.io/passbook/ (or your GitHub Pages URL)
- **Backend API**: Get from CloudFormation outputs after deployment

### Testing

- **Frontend**: Open `web-dashboard/index.html` in a browser
- **Backend**: `cd backend && source venv/bin/activate && pytest`

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for detailed deployment instructions.

## Documentation

- [Deployment Guide](docs/DEPLOYMENT.md) - Complete deployment instructions
- [Data Model](specs/001-passbook-complete/data-model.md)
- [Quick Start Guide](specs/001-passbook-complete/quickstart.md)
- [Architecture](specs/001-passbook-complete/plan.md)

## Contributing

1. Create a feature branch
2. Make your changes
3. Write tests
4. Submit a pull request

## License

MIT

## Support

For issues and questions, please open an issue on GitHub or contact support@embeddedinn.com.
