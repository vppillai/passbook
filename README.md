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

- **Frontend**: React Native with React Native Web, TypeScript, Expo SDK 49+
- **Backend**: AWS Serverless (Lambda, DynamoDB, API Gateway)
- **State Management**: Zustand
- **Charts**: Victory Native
- **Storage**: AsyncStorage (mobile), IndexedDB (web)
- **Notifications**: Expo Notifications

## Quick Start

### Prerequisites

- Node.js 18+ and npm 8+
- AWS CLI v2 configured
- Expo CLI: `npm install -g expo-cli`
- Python 3.11 (for Lambda development)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/vppillai/passbook.git
cd passbook
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment:
```bash
cp .env.example .env.local
# Edit .env.local with your configuration
```

4. Deploy backend infrastructure:
```bash
cd backend
pip install -r requirements.txt
./deploy.sh development
```

5. Start development server:
```bash
npm start
```

## Project Structure

```
passbook/
├── src/                    # React Native source code
│   ├── components/         # Reusable UI components
│   ├── screens/           # App screens
│   ├── services/          # API and business logic services
│   ├── store/             # Zustand state management
│   ├── utils/             # Utility functions
│   └── types/             # TypeScript type definitions
├── backend/               # AWS Lambda backend
│   ├── infrastructure/    # CloudFormation templates
│   ├── src/              # Lambda function code
│   └── tests/            # Backend tests
└── platform/             # Platform-specific code
    └── web/              # Web-specific implementations
```

## Development

### Running the App

- **Web**: `npm run web`
- **iOS**: `npm run ios` (requires macOS)
- **Android**: `npm run android`

### Testing

- **Frontend**: `npm test`
- **Backend**: `cd backend && pytest`

### Building

- **Web**: `npm run build:web`
- **Mobile**: `eas build --platform ios` or `eas build --platform android`

## Deployment

See [docs/deployment.md](docs/deployment.md) for detailed deployment instructions.

## Documentation

- [API Documentation](docs/api.md)
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
