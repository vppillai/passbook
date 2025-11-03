# Tasks: Allowance Passbook

**Input**: Design documents from `/specs/001-allowance-passbook/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: The specification does not explicitly request tests. Tests are OPTIONAL - only include if explicitly requested.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Web app**: `frontend/src/`
- Paths shown below follow the plan.md structure

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Create project structure per implementation plan
- [ ] T002 Initialize React app with Vite and TypeScript
- [ ] T003 [P] Install and configure core dependencies (React Router, Zustand, Tailwind CSS)
- [ ] T004 [P] Configure PWA manifest in frontend/public/manifest.json
- [ ] T005 [P] Setup Tailwind CSS configuration and global styles in frontend/src/styles/
- [ ] T006 [P] Configure TypeScript with strict mode in tsconfig.json
- [ ] T007 [P] Setup ESLint and Prettier configurations
- [ ] T008 Create base folder structure (components, pages, services, hooks, utils)
- [ ] T009 [P] Configure Workbox for service worker in frontend/vite.config.ts
- [ ] T010 [P] Setup environment variables structure in frontend/.env.example

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T011 Setup IndexedDB schema with Dexie in frontend/src/services/storage/db.ts
- [ ] T012 [P] Create base storage service wrapper in frontend/src/services/storage/storage.service.ts
- [ ] T013 [P] Implement theme system (dark/light mode) in frontend/src/contexts/theme.context.tsx
- [ ] T014 [P] Create authentication context and hooks in frontend/src/contexts/auth.context.tsx
- [ ] T015 [P] Setup React Router with route guards in frontend/src/App.tsx
- [ ] T016 [P] Create base layout components in frontend/src/components/common/Layout.tsx
- [ ] T017 [P] Implement offline detection hook in frontend/src/hooks/useOffline.ts
- [ ] T018 Create Zustand store structure in frontend/src/stores/
- [ ] T019 [P] Setup error boundary component in frontend/src/components/common/ErrorBoundary.tsx
- [ ] T020 [P] Create common UI components (Button, Input, Modal) in frontend/src/components/common/

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Parent Account Setup & Child Management (Priority: P1) 🎯 MVP

**Goal**: Enable parents to create accounts and add children

**Independent Test**: Parent can create account, add child, and both can login

### Implementation for User Story 1

- [ ] T021 [P] [US1] Create ParentAccount model interface in frontend/src/types/models.ts
- [ ] T022 [P] [US1] Create ChildAccount model interface in frontend/src/types/models.ts
- [ ] T023 [P] [US1] Create AccountingPeriod model interface in frontend/src/types/models.ts
- [ ] T024 [US1] Implement parent account service in frontend/src/services/accounts/parent.service.ts
- [ ] T025 [US1] Implement child account service in frontend/src/services/accounts/child.service.ts
- [ ] T026 [P] [US1] Create parent signup page in frontend/src/pages/auth/ParentSignup.tsx
- [ ] T027 [P] [US1] Create login page for both users in frontend/src/pages/auth/Login.tsx
- [ ] T028 [P] [US1] Create currency selector component in frontend/src/components/common/CurrencySelector.tsx
- [ ] T029 [US1] Implement authentication service in frontend/src/services/auth/auth.service.ts
- [ ] T030 [P] [US1] Create parent dashboard page in frontend/src/pages/parent/ParentDashboard.tsx
- [ ] T031 [P] [US1] Create add child modal component in frontend/src/components/accounts/AddChildModal.tsx
- [ ] T032 [US1] Add parent account creation to IndexedDB in frontend/src/services/storage/parent.storage.ts
- [ ] T033 [US1] Add child account creation to IndexedDB in frontend/src/services/storage/child.storage.ts
- [ ] T034 [US1] Implement initial accounting period creation logic in frontend/src/services/periods/period.service.ts
- [ ] T035 [P] [US1] Create child account card component in frontend/src/components/accounts/ChildAccountCard.tsx
- [ ] T036 [US1] Add routing for parent and child login flows in frontend/src/routes/auth.routes.tsx
- [ ] T037 [P] [US1] Create password validation utilities in frontend/src/utils/validation.ts

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Child Expense Tracking (Priority: P1) 🎯 MVP

**Goal**: Enable children to track expenses with visual analytics

**Independent Test**: Child can login, add/edit expenses, view balance, and see analytics

### Implementation for User Story 2

- [ ] T038 [P] [US2] Create Expense model interface in frontend/src/types/models.ts
- [ ] T039 [P] [US2] Create Category model and predefined data in frontend/src/data/categories.ts
- [ ] T040 [US2] Implement expense service in frontend/src/services/expenses/expense.service.ts
- [ ] T041 [P] [US2] Create child dashboard page in frontend/src/pages/child/ChildDashboard.tsx
- [ ] T042 [P] [US2] Create floating action button (FAB) component in frontend/src/components/common/FAB.tsx
- [ ] T043 [P] [US2] Create expense form modal in frontend/src/components/expenses/ExpenseFormModal.tsx
- [ ] T044 [P] [US2] Create category picker component in frontend/src/components/expenses/CategoryPicker.tsx
- [ ] T045 [P] [US2] Create balance display component with sticky positioning in frontend/src/components/expenses/BalanceDisplay.tsx
- [ ] T046 [P] [US2] Create expense list component in frontend/src/components/expenses/ExpenseList.tsx
- [ ] T047 [P] [US2] Create expense item component in frontend/src/components/expenses/ExpenseItem.tsx
- [ ] T048 [US2] Implement balance calculation logic in frontend/src/services/balance/balance.service.ts
- [ ] T049 [US2] Add expense CRUD operations to IndexedDB in frontend/src/services/storage/expense.storage.ts
- [ ] T050 [P] [US2] Create negative balance warning component in frontend/src/components/expenses/NegativeBalanceWarning.tsx
- [ ] T051 [P] [US2] Create analytics menu item in frontend/src/components/navigation/NavigationMenu.tsx
- [ ] T052 [P] [US2] Create analytics page in frontend/src/pages/shared/Analytics.tsx
- [ ] T053 [P] [US2] Implement pie chart component using Chart.js in frontend/src/components/reports/PieChart.tsx
- [ ] T054 [P] [US2] Implement line graph component with time granularity in frontend/src/components/reports/LineGraph.tsx
- [ ] T055 [US2] Create analytics data service in frontend/src/services/analytics/analytics.service.ts
- [ ] T056 [P] [US2] Create time granularity selector in frontend/src/components/reports/TimeGranularitySelector.tsx
- [ ] T057 [US2] Add expense editing functionality in frontend/src/services/expenses/expense.service.ts

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Parent Fund Management & Monitoring (Priority: P2)

**Goal**: Enable parents to manage funds and monitor children's spending

**Independent Test**: Parent can add funds, view child expenses, switch between children

### Implementation for User Story 3

- [ ] T058 [P] [US3] Create FundAddition model interface in frontend/src/types/models.ts
- [ ] T059 [US3] Implement fund addition service in frontend/src/services/funds/fund.service.ts
- [ ] T060 [P] [US3] Create add funds modal component in frontend/src/components/funds/AddFundsModal.tsx
- [ ] T061 [P] [US3] Create child selector component in frontend/src/components/accounts/ChildSelector.tsx
- [ ] T062 [P] [US3] Enhance parent dashboard with child switching in frontend/src/pages/parent/ParentDashboard.tsx
- [ ] T063 [P] [US3] Create parent expense view component in frontend/src/components/expenses/ParentExpenseView.tsx
- [ ] T064 [US3] Add fund addition to IndexedDB in frontend/src/services/storage/fund.storage.ts
- [ ] T065 [P] [US3] Create balance notification component for fund additions in frontend/src/components/funds/BalanceNotification.tsx
- [ ] T066 [US3] Implement parent expense creation on behalf of child in frontend/src/services/expenses/expense.service.ts
- [ ] T067 [P] [US3] Create child financial summary component in frontend/src/components/accounts/ChildFinancialSummary.tsx
- [ ] T068 [US3] Update balance calculation to include fund additions in frontend/src/services/balance/balance.service.ts

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: User Story 4 - Historical Data & Reporting (Priority: P3)

**Goal**: Enable viewing historical data and exporting reports

**Independent Test**: Users can view past months and export Excel/PDF reports

### Implementation for User Story 4

- [ ] T069 [P] [US4] Create period selector component in frontend/src/components/shared/PeriodSelector.tsx
- [ ] T070 [US4] Implement historical data retrieval in frontend/src/services/history/history.service.ts
- [ ] T071 [P] [US4] Create historical view page in frontend/src/pages/shared/HistoricalView.tsx
- [ ] T072 [P] [US4] Create export menu component in frontend/src/components/reports/ExportMenu.tsx
- [ ] T073 [P] [US4] Implement Excel export using SheetJS in frontend/src/services/export/excel.service.ts
- [ ] T074 [P] [US4] Implement PDF export using jsPDF in frontend/src/services/export/pdf.service.ts
- [ ] T075 [P] [US4] Create date range picker component in frontend/src/components/reports/DateRangePicker.tsx
- [ ] T076 [US4] Create export data formatter in frontend/src/utils/export-formatter.ts
- [ ] T077 [P] [US4] Create month navigation component in frontend/src/components/navigation/MonthNavigator.tsx
- [ ] T078 [US4] Implement period balance calculations in frontend/src/services/periods/period-balance.service.ts
- [ ] T079 [P] [US4] Create download progress indicator in frontend/src/components/reports/DownloadProgress.tsx

**Checkpoint**: Historical viewing and reporting features complete

---

## Phase 7: User Story 5 - Customization & Preferences (Priority: P3)

**Goal**: Enable theme customization and accounting period management

**Independent Test**: Users can switch themes and parents can customize accounting periods

### Implementation for User Story 5

- [ ] T080 [P] [US5] Create settings page for parents in frontend/src/pages/parent/Settings.tsx
- [ ] T081 [P] [US5] Create settings page for children in frontend/src/pages/child/Settings.tsx
- [ ] T082 [P] [US5] Create theme toggle component in frontend/src/components/settings/ThemeToggle.tsx
- [ ] T083 [P] [US5] Create accounting period editor in frontend/src/components/settings/AccountingPeriodEditor.tsx
- [ ] T084 [US5] Implement custom accounting period logic in frontend/src/services/periods/custom-period.service.ts
- [ ] T085 [P] [US5] Create new period starter component in frontend/src/components/settings/NewPeriodStarter.tsx
- [ ] T086 [US5] Implement period closing and balance snapshot in frontend/src/services/periods/period-close.service.ts
- [ ] T087 [P] [US5] Create period type selector (monthly/biweekly/custom) in frontend/src/components/settings/PeriodTypeSelector.tsx
- [ ] T088 [US5] Update theme context to persist preferences in frontend/src/contexts/theme.context.tsx

**Checkpoint**: All customization features operational

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T089 [P] Add loading states to all async operations in frontend/src/components/common/LoadingStates.tsx
- [ ] T090 [P] Add error handling UI components in frontend/src/components/common/ErrorMessages.tsx
- [ ] T091 [P] Implement data validation across all forms in frontend/src/utils/validation.ts
- [ ] T092 Add offline queue for sync operations in frontend/src/services/sync/offline-queue.service.ts
- [ ] T093 [P] Add accessibility attributes to all interactive elements
- [ ] T094 Implement data migration utilities in frontend/src/services/storage/migration.service.ts
- [ ] T095 [P] Add performance monitoring hooks in frontend/src/hooks/usePerformance.ts
- [ ] T096 Create app tour/onboarding flow in frontend/src/components/onboarding/AppTour.tsx
- [ ] T097 [P] Add keyboard navigation support throughout the app
- [ ] T098 Optimize bundle size and implement code splitting in frontend/vite.config.ts
- [ ] T099 [P] Add meta tags for PWA and SEO in frontend/index.html
- [ ] T100 Configure GitHub Actions workflow for GitHub Pages deployment in .github/workflows/deploy.yml
- [ ] T101 [P] Configure Vite base path for GitHub Pages in frontend/vite.config.ts
- [ ] T102 [P] Create CNAME file for custom domain (if needed) in frontend/public/CNAME

---

## Phase 9: Backend Security (OPTIONAL - Only if Cloud Sync Requested)

**Purpose**: Secure API implementation to prevent bot attacks while using AWS-provided URLs

**⚠️ CRITICAL**: Only implement if users explicitly request cloud sync. The app works perfectly without any backend.

### Security Implementation Tasks

- [ ] T103 Configure API Gateway with AWS-provided URLs (no custom domain) in backend/infrastructure/api-gateway.yaml
- [ ] T104 [P] Implement JWT authentication with 15-minute expiration in backend/src/middleware/jwt-auth.js
- [ ] T105 [P] Add API key validation layer in backend/src/middleware/api-key-auth.js
- [ ] T106 Set up API Gateway rate limiting and usage plans in backend/infrastructure/usage-plans.yaml
- [ ] T107 [P] Create Lambda authorizer for bot detection in backend/src/authorizers/bot-detector.js
- [ ] T108 [P] Implement CORS to allow only GitHub Pages origins in backend/src/middleware/cors.js
- [ ] T109 Create API key generation and rotation system in backend/src/services/api-key-service.js
- [ ] T110 [P] Set up CloudWatch alarms for security monitoring in backend/infrastructure/alarms.yaml
- [ ] T111 [P] Configure DynamoDB with encryption at rest in backend/infrastructure/dynamodb.yaml
- [ ] T112 [P] Implement request validation schemas in backend/src/validators/request-schemas.js
- [ ] T113 Create Lambda functions with minimal IAM permissions in backend/infrastructure/lambda-roles.yaml
- [ ] T114 [P] Add input sanitization middleware in backend/src/middleware/sanitizer.js
- [ ] T115 [P] Implement user-scoped data access in backend/src/services/data-access.js
- [ ] T116 Create security incident response runbook in backend/docs/security-runbook.md
- [ ] T117 [P] Add cost monitoring alerts ($10/month budget) in backend/infrastructure/billing-alerts.yaml
- [ ] T118 Test rate limiting and bot protection in backend/tests/security/

**Checkpoint**: Backend is secure against bot attacks while maintaining cost efficiency

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-7)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Phase 8)**: Depends on all desired user stories being complete
- **Backend Security (Phase 9)**: OPTIONAL - only if cloud sync requested
  - Can start after Phase 1 (Setup)
  - Independent of user stories
  - Must complete before enabling sync features

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - May reuse auth from US1 but independently testable
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) - Builds on US1 parent features but independently testable
- **User Story 4 (P3)**: Can start after Foundational (Phase 2) - Requires expense data but can use test data
- **User Story 5 (P3)**: Can start after Foundational (Phase 2) - Modifies existing features but independently testable

### Within Each User Story

- Models before services
- Services before UI components
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- Models within a story marked [P] can run in parallel
- UI components within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 2

```bash
# Launch all models together:
Task: "Create Expense model interface in frontend/src/types/models.ts"
Task: "Create Category model and predefined data in frontend/src/data/categories.ts"

# Launch all UI components together:
Task: "Create child dashboard page in frontend/src/pages/child/ChildDashboard.tsx"
Task: "Create floating action button (FAB) component in frontend/src/components/common/FAB.tsx"
Task: "Create expense form modal in frontend/src/components/expenses/ExpenseFormModal.tsx"
Task: "Create category picker component in frontend/src/components/expenses/CategoryPicker.tsx"
Task: "Create balance display component with sticky positioning in frontend/src/components/expenses/BalanceDisplay.tsx"
```

---

## Implementation Strategy

### MVP First (User Stories 1 & 2 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Parent setup)
4. Complete Phase 4: User Story 2 (Child tracking)
5. **STOP and VALIDATE**: Test core functionality
6. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo
3. Add User Story 2 → Test independently → Deploy/Demo (MVP!)
4. Add User Story 3 → Test parent oversight → Deploy/Demo
5. Add User Story 4 → Test reporting → Deploy/Demo
6. Add User Story 5 → Test customization → Deploy/Demo

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (Parent setup)
   - Developer B: User Story 2 (Child tracking)
   - Developer C: User Story 3 (Fund management)
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Tests are optional - not requested in specification
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
