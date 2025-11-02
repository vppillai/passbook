# passbook Development Guidelines

Auto-generated from all feature plans. Last updated: 2025-11-02

## Active Technologies

- JavaScript/TypeScript with Node.js 20.x + React 18, Vite, IndexedDB, Workbox (PWA), React Router, Zustand (state management) (001-teen-passbook)

## Project Structure

```text
backend/
frontend/
tests/
```

## Deployment

**GitHub Pages Only** - This project uses static hosting on GitHub Pages:
- Automatic deployment via GitHub Actions on push to main
- No backend services required for core functionality
- Optional AWS services (Lambda + DynamoDB) only if cloud sync needed
- All infrastructure must be cost-efficient (free tier when possible)

## Commands

npm test && npm run lint
npm run build       # Build for GitHub Pages
npm run preview     # Preview production build

## Code Style

JavaScript/TypeScript with Node.js 20.x: Follow standard conventions

## Recent Changes

- 001-teen-passbook: Added JavaScript/TypeScript with Node.js 20.x + React 18, Vite, IndexedDB, Workbox (PWA), React Router, Zustand (state management)

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
