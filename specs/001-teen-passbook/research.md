# Research: Teen Passbook

**Date**: 2025-11-02  
**Feature**: Teen expense tracking PWA with parent-child account management

## Technical Decisions

### 1. Frontend Framework: React 18 with TypeScript

**Decision**: React 18 with TypeScript for the frontend application

**Rationale**:
- React's component model perfect for reusable UI elements (expense cards, account selectors)
- TypeScript provides type safety crucial for financial calculations
- Excellent PWA support through Create React App or Vite
- Large ecosystem for required features (charts, export libraries)
- Strong mobile performance with React 18's automatic batching

**Alternatives considered**:
- Vue.js: Smaller learning curve but less mature PWA tooling
- Angular: Too heavy for a mobile-first teen app
- Vanilla JS: Would require building too much infrastructure

### 2. Build Tool: Vite

**Decision**: Vite for development and build tooling

**Rationale**:
- Significantly faster dev server startup than webpack
- Built-in TypeScript support
- Excellent PWA plugin ecosystem
- Smaller bundle sizes with better tree-shaking
- Native ES modules in development

**Alternatives considered**:
- Create React App: Slower, less flexible, maintenance concerns
- Webpack: More complex configuration for similar results
- Parcel: Less mature ecosystem for React development

### 3. Offline Storage: IndexedDB with Dexie.js

**Decision**: IndexedDB wrapped with Dexie.js for offline-first storage

**Rationale**:
- IndexedDB provides unlimited storage (unlike localStorage's 5-10MB)
- Dexie.js offers a promise-based API with TypeScript support
- Supports complex queries needed for date ranges and categories
- Can store binary data for future photo receipt features
- Automatic versioning and migration support

**Alternatives considered**:
- LocalStorage: Too limited for transaction history
- WebSQL: Deprecated
- PouchDB: Overkill for initial requirements, adds 46KB

### 4. State Management: Zustand

**Decision**: Zustand for global state management

**Rationale**:
- Tiny bundle size (8KB) vs Redux (60KB+)
- Simple API perfect for teen app complexity level
- Built-in persistence middleware for offline state
- TypeScript first-class support
- No boilerplate unlike Redux

**Alternatives considered**:
- Redux Toolkit: Too complex for this scale
- Context API only: Performance issues with frequent balance updates
- MobX: Larger bundle, more complex concepts

### 5. PWA Implementation: Workbox

**Decision**: Workbox for service worker and offline functionality

**Rationale**:
- Google's official PWA library with best practices built-in
- Precaching strategies for offline-first experience
- Background sync for deferred cloud updates
- Automatic service worker updates
- 10KB overhead acceptable for features provided

**Alternatives considered**:
- Manual service worker: Error-prone, requires expertise
- PWA plugins only: Less control over caching strategies

### 6. UI Component Library: Custom with Tailwind CSS

**Decision**: Custom components with Tailwind CSS for styling

**Rationale**:
- Full control over minimalist design requirements
- Tailwind's utility classes perfect for rapid development
- Smaller bundle than Material-UI or Ant Design
- Better performance on low-end teen devices
- Dark mode support built into Tailwind

**Alternatives considered**:
- Material-UI: Too heavy (300KB+), not teen-aesthetic
- Ant Design: Desktop-focused, large bundle
- Chakra UI: Good but adds unnecessary weight

### 7. Routing: React Router v6

**Decision**: React Router v6 for navigation

**Rationale**:
- Industry standard for React apps
- Excellent TypeScript support
- Lazy loading for code splitting
- Nested routing perfect for parent/child account structure
- Small bundle impact (15KB)

**Alternatives considered**:
- Reach Router: Merged into React Router
- Custom routing: Unnecessary complexity

### 8. Data Export: SheetJS and jsPDF

**Decision**: SheetJS for Excel, jsPDF for PDF generation

**Rationale**:
- SheetJS: Battle-tested Excel generation, 200KB but loadable on-demand
- jsPDF: Reliable PDF creation, 150KB lazy-loaded
- Both work entirely client-side (no server needed)
- Support for formatted financial reports

**Alternatives considered**:
- Server-side generation: Violates offline-first principle
- CSV only: Insufficient for parent needs

### 9. Authentication: JWT with secure storage

**Decision**: JSON Web Tokens stored in IndexedDB (not localStorage)

**Rationale**:
- Stateless authentication for future backend
- IndexedDB storage more secure than localStorage
- Can work offline once authenticated
- Supports remember-me functionality

**Alternatives considered**:
- Session cookies: Requires backend from start
- OAuth: Overkill for email/password auth

### 10. Testing Strategy

**Decision**: Vitest + React Testing Library + Playwright

**Rationale**:
- Vitest: Fast, Jest-compatible, works great with Vite
- RTL: Tests user behavior, not implementation
- Playwright: Cross-browser E2E testing including mobile

**Alternatives considered**:
- Jest: Slower with Vite projects
- Cypress: Larger, doesn't support mobile as well

## Architecture Patterns

### Offline-First Architecture

**Pattern**: Local-first with optional sync

**Implementation**:
1. All data writes go to IndexedDB first
2. UI updates immediately from local state
3. Background sync queue for cloud updates
4. Conflict resolution: Last-write-wins with history

### Component Architecture

**Pattern**: Feature-based organization

**Structure**:
```
components/
  expenses/
    ExpenseCard.tsx
    ExpenseForm.tsx
    ExpenseList.tsx
    index.ts
```

**Benefits**:
- Related components grouped together
- Easy to find and maintain
- Clear ownership boundaries

### Data Flow Architecture

**Pattern**: Unidirectional data flow

**Flow**:
1. User action → Service layer
2. Service updates IndexedDB
3. IndexedDB triggers state update
4. State update re-renders UI

## Performance Optimizations

### Bundle Splitting

- Route-based splitting (parent vs teen dashboards)
- Lazy load export libraries (300KB saved from initial)
- Separate vendor bundle for caching

### Image Optimization

- WebP with fallbacks for any future images
- Lazy loading for expense history
- Virtual scrolling for long lists

### Caching Strategy

- Precache app shell and critical assets
- Runtime cache for API responses
- Stale-while-revalidate for non-critical updates

## Security Considerations

### Client-Side Security

- No sensitive data in localStorage
- Sanitize all user inputs
- Content Security Policy headers
- HTTPS-only deployment

### Data Privacy

- Encryption at rest using WebCrypto API
- No analytics without consent
- Data export includes all user data
- Clear data deletion options

## Deployment Strategy

### GitHub Actions Pipeline

```yaml
- Build and test on PR
- Deploy to staging on merge
- Production deploy on tag
- Lighthouse CI for performance
```

### Hosting: GitHub Pages

**Decision**: GitHub Pages for static hosting

**Rationale**:
- Zero cost hosting solution
- Direct integration with GitHub repository
- Automatic HTTPS with github.io domain
- Custom domain support included
- Simple GitHub Actions deployment
- No additional accounts needed

**Alternatives considered**:
- Netlify: Additional service dependency, not needed for static site
- Vercel: Similar to Netlify, adds complexity
- AWS S3 + CloudFront: Overkill for static PWA
- Traditional hosting: Unnecessary cost for static site

## Future Considerations

### Phase 2: Backend Implementation (OPTIONAL)

**Only implement if users explicitly request cloud sync:**
- AWS Lambda + DynamoDB (pay-per-request, on-demand pricing)
- RESTful API (simpler than GraphQL, lower complexity)
- Manual sync triggers (not real-time, to reduce costs)
- Simple JWT auth (no Cognito to avoid costs)

**Cost optimization strategies:**
- Stay within AWS Free Tier limits
- Use DynamoDB on-demand (pay only for usage)
- Lambda with minimal memory allocation (128MB)
- API Gateway with usage plans/throttling

**Security measures (no custom domain, pay-per-use only):**
- Use AWS-provided API Gateway URLs as-is
- Implement API keys + JWT dual authentication
- API Gateway built-in throttling (no extra cost)
- Lambda authorizers for bot detection (pay per invocation)
- Strict rate limiting (10 req/sec per user)
- Usage plans with daily quotas (no extra cost)
- CORS restrictions to GitHub Pages origins only

### Monetization Ready

Architecture supports future:
- Premium features (multi-currency, advanced reports)
- Family subscriptions
- School/classroom editions
- Ad-supported free tier

### Scalability Path

Current architecture scales to:
- 100k users with CDN only
- 1M users with backend enabled
- Multi-region with DynamoDB Global Tables
