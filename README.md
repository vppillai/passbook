# Teen Passbook

A Progressive Web App (PWA) that helps teenagers track expenses and learn budgeting through practical money management. Parents create family accounts and manage allowances while teens track spending with visual insights.

## 🌟 Features

- 👨‍👩‍👧‍👦 **Parent-Child Account System**: Hierarchical account structure with separate logins
- 💰 **Expense Tracking**: Categories, descriptions, and real-time balance updates
- 📊 **Visual Analytics**: Pie charts and line graphs for spending insights
- 📱 **Mobile-First PWA**: Works offline, installable on devices
- 🌓 **Dark/Light Themes**: User preference support
- 📤 **Export Reports**: Excel and PDF generation for record keeping
- 💳 **Multi-Currency**: CAD default with selectable currencies
- ⚡ **Offline-First**: All data stored locally with optional sync

## 🚀 Deployment

### GitHub Pages (Primary)

This project is designed for **static hosting on GitHub Pages** with zero infrastructure costs:

```bash
# Automatic deployment via GitHub Actions
git push origin main

# Access at: https://[username].github.io/passbook/
# Or with custom domain: https://your-domain.com
```

**Key Points:**
- ✅ **Free hosting** via GitHub Pages
- ✅ **No backend required** - runs entirely in the browser
- ✅ **Offline-first** with IndexedDB for data storage
- ✅ **PWA installable** from GitHub Pages

### Optional AWS Backend (Future Enhancement)

If cloud sync is needed in the future, the app supports minimal AWS services:

- **AWS Lambda**: Pay-per-request serverless functions
- **DynamoDB**: On-demand pricing for data storage  
- **API Gateway**: With built-in throttling and usage plans
- **All services are pay-per-use** - no fixed monthly costs

**Security Features (All Pay-Per-Use):**
- ✅ No custom domain (uses AWS URLs as-is)
- ✅ Dual authentication (JWT + API keys)
- ✅ API Gateway throttling (built-in, no extra cost)
- ✅ Lambda authorizers for bot detection (pay per invocation)
- ✅ Usage plans with daily quotas (built-in)
- ✅ CORS restricted to GitHub Pages only
- ✅ Request validation at API Gateway (built-in)

**Cost Optimization (100% Pay-Per-Use):**
- Only activated when users explicitly need cloud sync
- NO fixed monthly costs - you only pay for actual usage
- Typical cost: $0-5/month (most users stay in free tier)
- All security features are usage-based
- CloudWatch alerts at $5 to prevent surprises

## 🛠️ Technical Stack

### Frontend (Required)
- **React 18** with TypeScript
- **Vite** for fast builds
- **IndexedDB** for offline storage
- **Workbox** for PWA capabilities
- **Tailwind CSS** for styling
- **GitHub Actions** for CI/CD

### Backend (Optional - Not Required for MVP)
- AWS Lambda (serverless)
- DynamoDB (on-demand)
- API Gateway (usage limits)

## 💡 Architecture Principles

1. **Static-First**: Everything runs in the browser
2. **Offline-First**: Local storage with optional sync
3. **Cost-Efficient**: GitHub Pages + optional cheap AWS
4. **Privacy-Focused**: Data stays on device by default

## 🏃 Quick Start

```bash
# Clone repository
git clone https://github.com/[username]/passbook.git
cd passbook

# Install dependencies
cd frontend
npm install

# Start development
npm run dev

# Build for production
npm run build
```

## 📁 Project Structure

```
passbook/
├── frontend/              # React PWA application
│   ├── src/              # Source code
│   ├── public/           # Static assets
│   └── dist/             # Build output (deployed to GitHub Pages)
├── .github/
│   └── workflows/        # GitHub Actions for deployment
├── specs/                # Feature specifications
└── backend/              # Optional AWS functions (future)
```

## 🎯 Development Philosophy

- **No Unnecessary Costs**: GitHub Pages for free hosting
- **Progressive Enhancement**: Works offline, enhances with online
- **User Privacy**: Local-first data storage
- **Educational Focus**: Helps teens learn budgeting

## 📚 Documentation

- [Feature Specification](specs/001-teen-passbook/spec.md)
- [Implementation Plan](specs/001-teen-passbook/plan.md)
- [Quick Start Guide](specs/001-teen-passbook/quickstart.md)
- [Data Model](specs/001-teen-passbook/data-model.md)
- [Security Architecture](specs/001-teen-passbook/security.md)
- [Pay-Per-Use Architecture](specs/001-teen-passbook/pay-per-use-architecture.md)

## 🤝 Constitution

This project follows the [Teen Passbook Constitution](.specify/memory/constitution.md) which emphasizes:
- Cost-efficient architecture (GitHub Pages + minimal AWS)
- Mobile-first development
- Teen-centered design
- Financial education through practical use

## 📄 License

[Choose appropriate license]

---

**Remember**: This is a static PWA hosted on GitHub Pages. No backend is required for the core functionality!
