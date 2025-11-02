# Teen Passbook - Quick Start Guide

**Feature**: Teen expense tracking PWA with parent-child account management  
**Branch**: `001-teen-passbook`  
**Last Updated**: 2025-11-02

## 🚀 Project Overview

Teen Passbook is a Progressive Web App (PWA) that helps teenagers track their expenses and learn budgeting through practical money management. Parents create family accounts, add their children, and manage allowances while teens track their spending with visual insights.

### Key Features
- 👪 Parent-child account hierarchy
- 💰 Expense tracking with categories
- 📊 Spending visualizations (pie chart & line graph)
- 🌓 Dark/light mode themes
- 📱 Mobile-first, offline-capable PWA
- 📈 Excel/PDF report exports

## 🏗️ Architecture

- **Frontend**: React 18 + TypeScript + Vite
- **State Management**: Zustand
- **Storage**: IndexedDB (offline-first)
- **Styling**: Tailwind CSS
- **PWA**: Workbox
- **Backend** (optional): AWS Lambda + DynamoDB

## 🛠️ Development Setup

### Prerequisites

```bash
# Required
node >= 20.x
npm >= 9.x

# Optional (for backend)
aws-cli >= 2.x
```

### Initial Setup

1. **Clone and checkout feature branch**:
```bash
git clone <repository-url>
cd passbook
git checkout 001-teen-passbook
```

2. **Install dependencies**:
```bash
cd frontend
npm install
```

3. **Set up environment variables**:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Start development server**:
```bash
npm run dev
# App will be available at http://localhost:5173
```

## 🏃 Common Commands

### Development
```bash
# Start dev server
npm run dev

# Run tests
npm run test

# Run tests in watch mode
npm run test:watch

# Type checking
npm run type-check

# Linting
npm run lint

# Format code
npm run format
```

### Building
```bash
# Build for production
npm run build

# Preview production build
npm run preview

# Build and analyze bundle
npm run build:analyze
```

### Testing
```bash
# Unit tests
npm run test:unit

# Integration tests  
npm run test:integration

# E2E tests
npm run test:e2e

# All tests with coverage
npm run test:coverage
```

## 📁 Project Structure

```
frontend/
├── src/
│   ├── components/          # Reusable UI components
│   │   ├── common/         # Button, Input, Modal, etc.
│   │   ├── expenses/       # ExpenseList, ExpenseForm, etc.
│   │   ├── accounts/       # AccountCard, ChildSelector
│   │   └── reports/        # Charts, ExportButton
│   ├── pages/              # Route pages
│   │   ├── auth/          # Login, Signup
│   │   ├── parent/        # Parent dashboard views
│   │   ├── teen/          # Teen dashboard views
│   │   └── shared/        # Analytics, Settings
│   ├── services/          # Business logic
│   │   ├── auth/          # Authentication
│   │   ├── storage/       # IndexedDB operations
│   │   ├── sync/          # Cloud sync (optional)
│   │   └── export/        # Report generation
│   ├── hooks/             # Custom React hooks
│   ├── utils/             # Helpers and utilities
│   └── styles/            # Global styles, themes
├── public/                # Static assets, PWA manifest
└── tests/                 # Test files
```

## 🧪 Testing Strategy

### Unit Tests
- Components: Test rendering and interactions
- Services: Test business logic
- Utils: Test pure functions

### Integration Tests
- User flows: Parent signup → Child creation → Expense tracking
- Data persistence: IndexedDB operations
- PWA features: Offline functionality

### E2E Tests
- Critical paths: Login, expense creation, report export
- Cross-browser: Chrome, Safari, Firefox
- Mobile viewports: Test responsive design

## 🚢 Deployment

### Frontend Deployment (GitHub Pages)

1. **Configure GitHub Pages**:
   - Go to repository Settings → Pages
   - Source: Deploy from a branch
   - Branch: `gh-pages` (or configure GitHub Actions)
   - Root folder

2. **Build configuration**:
   - Update `vite.config.ts` to set base path:
```javascript
export default {
  base: '/passbook/', // or '/' if using custom domain
}
```

3. **GitHub Actions workflow**:
   - Uses `.github/workflows/deploy.yml`
   - Builds and deploys on push to main
   - Automatic deployment to GitHub Pages

4. **Custom domain (optional)**:
   - Add CNAME file to public directory
   - Configure domain in GitHub Pages settings
   - Update DNS records as instructed

### Backend Deployment (AWS - OPTIONAL - Not Required for MVP)

**⚠️ NOTE**: The app runs entirely on GitHub Pages. Backend is only needed if users explicitly request cloud sync features.

**If cloud sync is requested by users:**

1. **Configure AWS CLI**:
```bash
aws configure
# Use minimal IAM permissions
```

2. **Deploy cost-optimized infrastructure**:
```bash
cd backend
# Uses DynamoDB on-demand + Lambda pay-per-request
npm run deploy:infrastructure
```

3. **Deploy functions with minimal resources**:
```bash
# Deploys with 128MB Lambda memory to minimize costs
npm run deploy:functions
```

**Security & Cost Management (Pay-Per-Use Only):**
- API URL: Use AWS-provided `https://xxx.execute-api.region.amazonaws.com/v1`
- No custom domain needed (reduces attack surface)
- Dual authentication: JWT + API keys
- API Gateway built-in throttling (no extra cost)
- Lambda authorizers for bot detection (pay per invocation)
- Usage plans with daily quotas (10K requests/day)
- Monitor AWS billing alerts (typical: $0-5/month)
- All security features are usage-based - no fixed costs
- Regular security audits and cost reviews

## 📋 Development Workflow

1. **Create feature branch**:
```bash
git checkout -b feature/your-feature-name
```

2. **Make changes**:
   - Write tests first (TDD)
   - Implement feature
   - Run tests locally

3. **Commit with conventional commits**:
```bash
git commit -m "feat: add expense analytics view"
git commit -m "fix: correct balance calculation"
```

4. **Push and create PR**:
```bash
git push origin feature/your-feature-name
# Create PR on GitHub
```

5. **CI/CD Pipeline**:
   - Automated tests run
   - Lighthouse performance check
   - Preview deployment created

## 🎯 Key Implementation Notes

### Offline-First Strategy
- All data writes go to IndexedDB first
- UI updates optimistically
- Background sync when online

### State Management
- Zustand stores for global state
- React Query for server state (if backend enabled)
- Local state for component-specific data

### Performance Targets
- First Contentful Paint < 1.5s on 3G
- 100% offline functionality
- Bundle size < 5MB initial load

### Accessibility
- WCAG 2.1 AA compliance
- Keyboard navigation support
- Screen reader friendly

## 🐛 Debugging

### Common Issues

**IndexedDB not working**:
```javascript
// Check browser support
if (!('indexedDB' in window)) {
  console.error('IndexedDB not supported');
}
```

**PWA not installing**:
- Check HTTPS (required for PWA)
- Verify manifest.json is valid
- Check service worker registration

**Balance calculations incorrect**:
- Verify timezone handling
- Check decimal precision (use cents internally)

### Debug Tools
- React DevTools
- Redux DevTools (for Zustand)
- Chrome DevTools → Application tab for PWA/IndexedDB

## 📚 Additional Resources

- [Specification](./spec.md) - Full feature requirements
- [Data Model](./data-model.md) - Entity relationships
- [API Contract](./contracts/api-v1.yaml) - REST API specification
- [Research](./research.md) - Technical decisions

## 🆘 Getting Help

1. Check the [specification](./spec.md) for requirements
2. Review [data model](./data-model.md) for entity details  
3. Consult [API contract](./contracts/api-v1.yaml) for endpoints
4. Create an issue for bugs/questions

## 🎉 Ready to Start!

You're all set to begin development. Start with:

1. Run `npm run dev` to start the development server
2. Open `http://localhost:5173` in your browser
3. Check out the test files for examples
4. Happy coding! 🚀
