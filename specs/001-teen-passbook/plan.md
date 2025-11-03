# Implementation Plan: Allowance Passbook

**Branch**: `001-allowance-passbook` | **Date**: 2025-11-02 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-allowance-passbook/spec.md`

## Summary

A multi-user financial tracking Progressive Web App (PWA) where parents create family accounts and manage their children's digital passbooks. Children track expenses by category, view balances, and learn budgeting through practical use. The app prioritizes offline-first functionality with optional cloud sync, supports multiple currencies (CAD default), and provides export capabilities for financial records.

## Technical Context

**Language/Version**: JavaScript/TypeScript with Node.js 20.x  
**Primary Dependencies**: React 18, Vite, IndexedDB, Workbox (PWA), React Router, Zustand (state management)  
**Storage**: IndexedDB for offline-first storage (GitHub Pages compatible), optional AWS DynamoDB for cloud sync (not required)  
**Testing**: Vitest, React Testing Library, Playwright for E2E  
**Target Platform**: Progressive Web App (PWA) - mobile-first, works on all devices  
**Project Type**: web - PWA with optional backend  
**Performance Goals**: First Contentful Paint < 1.5s on 3G, offline capable, instant balance updates  
**Constraints**: Offline-first, < 5MB initial bundle, works without backend initially  
**Scale/Scope**: 10k users, ~20 screens, multi-user with role-based access

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Initial Check (Pre-Research)**:
- [x] **Child-Centered Design**: Feature addresses actual child needs with age-appropriate UX
- [x] **Minimalist Interface**: UI requires ≤3 taps/clicks from home, no unnecessary elements
- [x] **Cost-Efficient Architecture**: Infrastructure costs justified, uses free tier where possible
- [x] **Mobile-First Development**: Designed for mobile first, works offline with sync
- [x] **Continuous Deployment**: Can be deployed via GitHub Actions with automated tests
- [x] **Financial Education**: Feature teaches budgeting/planning concepts through practical use

**Post-Design Validation (Phase 1 Complete)**:
- [x] **Child-Centered Design**: ✓ FAB button, visual analytics, negative balance warnings all child-friendly
- [x] **Minimalist Interface**: ✓ Analytics hidden in menu, FAB for quick access, ≤3 taps maintained
- [x] **Cost-Efficient Architecture**: ✓ IndexedDB-first, optional AWS backend, GitHub Pages free hosting
- [x] **Mobile-First Development**: ✓ PWA with offline-first, touch interactions, mobile breakpoints
- [x] **Continuous Deployment**: ✓ GitHub Actions ready, GitHub Pages auto-deploy configured
- [x] **Financial Education**: ✓ Visual charts, spending insights, negative balance teaching moments

## Project Structure

### Documentation (this feature)

```text
specs/001-allowance-passbook/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
frontend/
├── src/
│   ├── components/      # Reusable UI components
│   │   ├── common/      # Button, Input, Modal, etc.
│   │   ├── expenses/    # ExpenseList, ExpenseForm, CategoryPicker
│   │   ├── accounts/    # AccountCard, ChildSelector
│   │   └── reports/     # ReportGenerator, ExportButton
│   ├── pages/           # Route-based pages
│   │   ├── auth/        # Login, ParentSignup
│   │   ├── parent/      # ParentDashboard, ChildManagement, Settings
│   │   ├── child/        # ChildDashboard, ExpenseHistory
│   │   └── shared/      # Reports, PeriodSelector
│   ├── services/        # Business logic
│   │   ├── auth/        # Authentication service
│   │   ├── storage/     # IndexedDB wrapper
│   │   ├── sync/        # Optional cloud sync
│   │   └── export/      # Excel/PDF generation
│   ├── hooks/           # Custom React hooks
│   ├── utils/           # Helpers, formatters, validators
│   └── styles/          # Global styles, theme definitions
├── public/              # Static assets, PWA manifest
└── tests/               # Test files

backend/ (OPTIONAL - Only if cloud sync needed)
├── src/
│   ├── functions/       # AWS Lambda functions (pay-per-request)
│   ├── models/          # DynamoDB schemas (on-demand pricing)
│   └── api/             # API Gateway configs (with usage limits)
└── tests/
# NOTE: Backend is NOT required for core functionality
# App runs entirely on GitHub Pages with IndexedDB
```

**Structure Decision**: Web application structure selected due to PWA requirements and multi-device support needs. Frontend-only initially with optional backend for cloud sync. The structure supports offline-first architecture with clear separation of concerns for UI, business logic, and data management.

## Complexity Tracking

> No violations - all constitution principles are satisfied without compromise

## Phase Completion Status

### Phase 0: Research ✅
- Technical stack decisions documented
- All architecture choices justified
- No outstanding clarifications

### Phase 1: Design & Contracts ✅
- Data model created with all entities defined
- API contracts specified (OpenAPI 3.0)
- Developer quickstart guide written
- Agent context updated with tech stack

### Phase 2: Implementation Planning 🔜
- Ready for task breakdown (`/speckit.tasks`)
- All technical decisions finalized
- Constitution compliance validated