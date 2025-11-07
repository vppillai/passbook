# Tasks: Passbook - Family Allowance Management System

**Input**: Design documents from `/specs/001-passbook-mvp/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Tests are included based on requirements.md specifications (70%+ coverage target).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Frontend**: `src/` at repository root (React Native + Web)
- **Backend**: `backend/src/` for Lambda functions
- **Infrastructure**: `backend/infrastructure/` for CloudFormation
- **Tests**: `tests/` (frontend), `backend/tests/` (backend)

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Create project structure per implementation plan
- [ ] T002 Initialize React Native project with Expo SDK 49+
- [ ] T003 [P] Configure TypeScript 5.x for frontend in tsconfig.json
- [ ] T004 [P] Set up ESLint and Prettier configuration files
- [ ] T005 [P] Create backend directory structure with Python 3.11 requirements.txt
- [ ] T006 [P] Initialize package.json scripts for web, iOS, and Android builds
- [ ] T007 Configure app.json for Expo managed workflow
- [ ] T008 [P] Create .env.example with all required environment variables
- [ ] T009 [P] Set up .gitignore for React Native, Python, and AWS files

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T010 Create CloudFormation master template in backend/infrastructure/main.yaml
- [ ] T011 [P] Define DynamoDB tables schema in backend/infrastructure/database.yaml
- [ ] T012 [P] Configure API Gateway REST API in backend/infrastructure/api.yaml
- [ ] T013 [P] Set up AWS Secrets Manager for JWT and SMTP in backend/infrastructure/auth.yaml
- [ ] T014 Deploy initial CloudFormation stack with deploy.sh script
- [ ] T015 [P] Implement base Lambda handler utilities in backend/src/utils/lambda_handler.py
- [ ] T016 [P] Create JWT token management utilities in backend/src/utils/jwt_utils.py
- [ ] T017 [P] Implement DynamoDB client wrapper in backend/src/utils/db_client.py
- [ ] T018 [P] Set up React Navigation structure in src/navigation/index.tsx
- [ ] T019 [P] Configure API client service in src/services/api.ts
- [ ] T020 [P] Implement secure storage service in src/services/storage.ts
- [ ] T021 [P] Create base TypeScript interfaces in src/types/index.ts
- [ ] T022 Set up Zustand store configuration in src/store/index.ts
- [ ] T023 [P] Configure platform detection utilities in src/utils/platform.ts
- [ ] T024 [P] Create common UI components in src/components/common/

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Parent Account Setup & Family Creation (Priority: P1) 🎯 MVP

**Goal**: Enable parents to create accounts, verify email, and set up family

**Independent Test**: Parent can sign up, receive/click verification email, create family account

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T025 [P] [US1] Unit test for signup Lambda in backend/tests/unit/test_signup_handler.py
- [ ] T026 [P] [US1] Unit test for email verification in backend/tests/unit/test_verify_email.py
- [ ] T027 [P] [US1] Integration test for auth flow in backend/tests/integration/test_auth_flow.py
- [ ] T028 [P] [US1] Frontend test for SignupScreen in __tests__/screens/SignupScreen.test.tsx
- [ ] T029 [P] [US1] Frontend test for auth service in __tests__/services/auth.test.ts

### Implementation for User Story 1

- [ ] T030 [P] [US1] Create ParentAccount model in backend/src/models/parent_account.py
- [ ] T031 [P] [US1] Create FamilyAccount model in backend/src/models/family_account.py
- [ ] T032 [P] [US1] Create EmailVerification model in backend/src/models/email_verification.py
- [ ] T033 [US1] Implement signup Lambda handler in backend/src/lambdas/auth/signup_handler.py
- [ ] T034 [US1] Implement email verification Lambda in backend/src/lambdas/auth/verify_email_handler.py
- [ ] T035 [US1] Implement login Lambda handler in backend/src/lambdas/auth/login_handler.py
- [ ] T036 [US1] Create email service using Zoho SMTP in backend/src/utils/email_service.py
- [ ] T037 [US1] Implement family creation Lambda in backend/src/lambdas/accounts/create_family_handler.py
- [ ] T038 [P] [US1] Create SignupScreen component in src/screens/SharedScreens/SignupScreen.tsx
- [ ] T039 [P] [US1] Create LoginScreen component in src/screens/SharedScreens/LoginScreen.tsx
- [ ] T040 [P] [US1] Create EmailVerificationScreen in src/screens/SharedScreens/EmailVerificationScreen.tsx
- [ ] T041 [P] [US1] Create FamilySetupScreen in src/screens/ParentScreens/FamilySetupScreen.tsx
- [ ] T042 [US1] Implement auth service methods in src/services/auth.ts
- [ ] T043 [US1] Add auth state to Zustand store in src/store/authSlice.ts
- [ ] T044 [US1] Configure deep linking for email verification in src/navigation/linking.ts
- [ ] T045 [US1] Deploy User Story 1 Lambda functions with deploy-function.sh

**Checkpoint**: Parent account creation and family setup fully functional

---

## Phase 4: User Story 2 - Child Account Management (Priority: P1)

**Goal**: Parents can add/manage child accounts with unique usernames

**Independent Test**: Parent adds child, sets username/password, child can login independently

### Tests for User Story 2 ⚠️

- [ ] T046 [P] [US2] Unit test for child account creation in backend/tests/unit/test_child_account.py
- [ ] T047 [P] [US2] Unit test for username uniqueness in backend/tests/unit/test_username_check.py
- [ ] T048 [P] [US2] Integration test child management in backend/tests/integration/test_child_mgmt.py
- [ ] T049 [P] [US2] Frontend test ChildManagementScreen in __tests__/screens/ChildManagement.test.tsx

### Implementation for User Story 2

- [ ] T050 [P] [US2] Create ChildAccount model in backend/src/models/child_account.py
- [ ] T051 [US2] Implement create child Lambda in backend/src/lambdas/accounts/create_child_handler.py
- [ ] T052 [US2] Implement list children Lambda in backend/src/lambdas/accounts/list_children_handler.py
- [ ] T053 [US2] Implement update child Lambda in backend/src/lambdas/accounts/update_child_handler.py
- [ ] T054 [US2] Implement child password reset Lambda in backend/src/lambdas/accounts/reset_child_password.py
- [ ] T055 [US2] Add username uniqueness check in backend/src/utils/username_validator.py
- [ ] T056 [P] [US2] Create ChildManagementScreen in src/screens/ParentScreens/ChildManagementScreen.tsx
- [ ] T057 [P] [US2] Create AddChildModal component in src/components/dashboard/AddChildModal.tsx
- [ ] T058 [P] [US2] Create ChildAccountCard in src/components/dashboard/ChildAccountCard.tsx
- [ ] T059 [US2] Add child account service in src/services/childAccounts.ts
- [ ] T060 [US2] Update auth service for child login in src/services/auth.ts
- [ ] T061 [US2] Add child accounts to store in src/store/childrenSlice.ts

**Checkpoint**: Full child account management operational

---

## Phase 5: User Story 3 - Fund Management & Allowance Tracking (Priority: P1)

**Goal**: Parents add funds, children see balance and funding countdown

**Independent Test**: Parent adds funds, child sees updated balance and next funding date

### Tests for User Story 3 ⚠️

- [ ] T062 [P] [US3] Unit test fund addition in backend/tests/unit/test_add_funds.py
- [ ] T063 [P] [US3] Unit test balance calculations in backend/tests/unit/test_balance.py
- [ ] T064 [P] [US3] Integration test funding flow in backend/tests/integration/test_funding.py
- [ ] T065 [P] [US3] Frontend test FundingScreen in __tests__/screens/FundingScreen.test.tsx

### Implementation for User Story 3

- [ ] T066 [P] [US3] Create FundAddition model in backend/src/models/fund_addition.py
- [ ] T067 [US3] Implement add funds Lambda in backend/src/lambdas/expenses/add_funds_handler.py
- [ ] T068 [US3] Add balance update logic in backend/src/utils/balance_manager.py
- [ ] T069 [US3] Implement reminder service in backend/src/lambdas/email/reminder_handler.py
- [ ] T070 [P] [US3] Create AddFundsScreen in src/screens/ParentScreens/AddFundsScreen.tsx
- [ ] T071 [P] [US3] Create BalanceDisplay component in src/components/dashboard/BalanceDisplay.tsx
- [ ] T072 [P] [US3] Create FundingCountdown in src/components/dashboard/FundingCountdown.tsx
- [ ] T073 [US3] Add funding service in src/services/funding.ts
- [ ] T074 [US3] Update child dashboard in src/screens/ChildScreens/ChildDashboard.tsx

**Checkpoint**: Funding and balance tracking fully functional

---

## Phase 6: User Story 4 - Expense Tracking by Children (Priority: P1)

**Goal**: Children can add categorized expenses and track spending

**Independent Test**: Child adds expense, sees updated balance and expense history

### Tests for User Story 4 ⚠️

- [ ] T075 [P] [US4] Unit test expense creation in backend/tests/unit/test_add_expense.py
- [ ] T076 [P] [US4] Unit test expense categories in backend/tests/unit/test_categories.py
- [ ] T077 [P] [US4] Integration test expense flow in backend/tests/integration/test_expense_flow.py
- [ ] T078 [P] [US4] Frontend test ExpenseScreen in __tests__/screens/ExpenseScreen.test.tsx

### Implementation for User Story 4

- [ ] T079 [P] [US4] Create Expense model in backend/src/models/expense.py
- [ ] T080 [US4] Implement add expense Lambda in backend/src/lambdas/expenses/add_expense_handler.py
- [ ] T081 [US4] Implement list expenses Lambda in backend/src/lambdas/expenses/list_expenses_handler.py
- [ ] T082 [US4] Implement update expense Lambda in backend/src/lambdas/expenses/update_expense_handler.py
- [ ] T083 [US4] Add overdraft checking in backend/src/utils/overdraft_checker.py
- [ ] T084 [P] [US4] Create AddExpenseScreen in src/screens/ChildScreens/AddExpenseScreen.tsx
- [ ] T085 [P] [US4] Create ExpenseListScreen in src/screens/ChildScreens/ExpenseListScreen.tsx
- [ ] T086 [P] [US4] Create CategoryPicker component in src/components/expenses/CategoryPicker.tsx
- [ ] T087 [P] [US4] Create ExpenseCard component in src/components/expenses/ExpenseCard.tsx
- [ ] T088 [US4] Add expense service in src/services/expenses.ts
- [ ] T089 [US4] Update store with expenses in src/store/expensesSlice.ts
- [ ] T090 [US4] Add floating action button in src/components/common/FAB.tsx

**Checkpoint**: Core MVP complete - all P1 stories functional

---

## Phase 7: User Story 5 - Multi-Parent Family Management (Priority: P2)

**Goal**: Support multiple parents with equal admin rights

**Independent Test**: Invite second parent, both can manage children equally

### Tests for User Story 5 ⚠️

- [ ] T091 [P] [US5] Unit test parent invitation in backend/tests/unit/test_invite_parent.py
- [ ] T092 [P] [US5] Integration test multi-parent in backend/tests/integration/test_multi_parent.py
- [ ] T093 [P] [US5] Frontend test parent mgmt in __tests__/screens/ParentManagement.test.tsx

### Implementation for User Story 5

- [ ] T094 [US5] Implement invite parent Lambda in backend/src/lambdas/accounts/invite_parent_handler.py
- [ ] T095 [US5] Implement list parents Lambda in backend/src/lambdas/accounts/list_parents_handler.py
- [ ] T096 [US5] Add invitation email template in backend/src/utils/email_templates.py
- [ ] T097 [P] [US5] Create ParentManagementScreen in src/screens/ParentScreens/ParentManagementScreen.tsx
- [ ] T098 [P] [US5] Create InviteParentModal in src/components/dashboard/InviteParentModal.tsx
- [ ] T099 [US5] Add parent invitation service in src/services/parentAccounts.ts
- [ ] T100 [US5] Implement password reset flow in src/screens/SharedScreens/PasswordResetScreen.tsx

**Checkpoint**: Multi-parent support complete

---

## Phase 8: User Story 6 - Analytics & Financial Reports (Priority: P2)

**Goal**: Generate spending analytics and professional reports

**Independent Test**: View pie charts, line graphs, export PDF/Excel reports

### Tests for User Story 6 ⚠️

- [ ] T101 [P] [US6] Unit test analytics calc in backend/tests/unit/test_analytics.py
- [ ] T102 [P] [US6] Unit test report generation in backend/tests/unit/test_reports.py
- [ ] T103 [P] [US6] Frontend test charts in __tests__/components/analytics/Charts.test.tsx

### Implementation for User Story 6

- [ ] T104 [US6] Implement analytics Lambda in backend/src/lambdas/analytics/get_analytics_handler.py
- [ ] T105 [US6] Implement report generator in backend/src/lambdas/analytics/generate_report_handler.py
- [ ] T106 [US6] Add PDF generation logic in backend/src/utils/pdf_generator.py
- [ ] T107 [US6] Add Excel generation logic in backend/src/utils/excel_generator.py
- [ ] T108 [P] [US6] Create AnalyticsScreen in src/screens/SharedScreens/AnalyticsScreen.tsx
- [ ] T109 [P] [US6] Implement PieChart component in src/components/analytics/PieChart.tsx
- [ ] T110 [P] [US6] Implement LineChart component in src/components/analytics/LineChart.tsx
- [ ] T111 [P] [US6] Create ReportExportModal in src/components/analytics/ReportExportModal.tsx
- [ ] T112 [US6] Add Victory Native charts in package.json dependencies
- [ ] T113 [US6] Implement @react-pdf/renderer templates in src/utils/pdfTemplates.tsx
- [ ] T114 [US6] Add analytics service in src/services/analytics.ts

**Checkpoint**: Analytics and reporting fully functional

---

## Phase 9: User Story 7 - Offline Functionality (Priority: P3)

**Goal**: Full offline support with automatic sync

**Independent Test**: Use app offline, changes sync when reconnected

### Tests for User Story 7 ⚠️

- [ ] T115 [P] [US7] Unit test offline queue in __tests__/services/offlineQueue.test.ts
- [ ] T116 [P] [US7] Integration test sync in __tests__/services/syncService.test.ts

### Implementation for User Story 7

- [ ] T117 [P] [US7] Implement IndexedDB adapter for web in platform/web/storage.ts
- [ ] T118 [P] [US7] Implement AsyncStorage adapter for mobile in src/services/storage.ts
- [ ] T119 [US7] Create offline queue manager in src/services/offlineQueue.ts
- [ ] T120 [US7] Implement sync service in src/services/syncService.ts
- [ ] T121 [US7] Add conflict resolution in src/utils/conflictResolver.ts
- [ ] T122 [US7] Create service worker for PWA in platform/web/service-worker.js
- [ ] T123 [US7] Add offline indicators in src/components/common/OfflineIndicator.tsx
- [ ] T124 [US7] Update all services to support offline in src/services/

**Checkpoint**: Full offline support implemented

---

## Phase 10: User Story 8 - Push Notifications (Priority: P3)

**Goal**: Push notifications for important events

**Independent Test**: Enable notifications, receive for balance/funding events

### Tests for User Story 8 ⚠️

- [ ] T125 [P] [US8] Unit test notification service in backend/tests/unit/test_notifications.py
- [ ] T126 [P] [US8] Frontend notification test in __tests__/services/notifications.test.ts

### Implementation for User Story 8

- [ ] T127 [US8] Set up Firebase Cloud Messaging in backend/infrastructure/notifications.yaml
- [ ] T128 [US8] Implement notification Lambda in backend/src/lambdas/notifications/send_notification.py
- [ ] T129 [US8] Add device token storage in backend/src/models/device_tokens.py
- [ ] T130 [P] [US8] Configure Expo push notifications in app.json
- [ ] T131 [P] [US8] Create notification service in src/services/notifications.ts
- [ ] T132 [P] [US8] Add notification settings in src/screens/SharedScreens/NotificationSettings.tsx
- [ ] T133 [US8] Implement notification handlers in src/utils/notificationHandlers.ts
- [ ] T134 [US8] Update child/parent dashboards with notification triggers

**Checkpoint**: Push notifications fully functional

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T135 [P] Create comprehensive README.md documentation
- [ ] T136 [P] Add API documentation in docs/api.md
- [ ] T137 [P] Create deployment guide in docs/deployment.md
- [ ] T138 Code cleanup and refactoring across all components
- [ ] T139 Performance optimization for large transaction lists
- [ ] T140 [P] Add loading states to all screens
- [ ] T141 [P] Implement error boundaries in src/components/ErrorBoundary.tsx
- [ ] T142 Security hardening - input validation across all forms
- [ ] T143 [P] Add app icons and splash screens for all platforms
- [ ] T144 Run quickstart.md validation end-to-end
- [ ] T145 [P] Configure GitHub Actions in .github/workflows/

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-10)**: All depend on Foundational phase completion
  - P1 stories (US1-4): Can proceed after Foundational
  - P2 stories (US5-6): Can start after Foundational (parallel to P1)
  - P3 stories (US7-8): Can start after Foundational (parallel to others)
- **Polish (Phase 11)**: Best after core stories (US1-4) complete

### User Story Dependencies

- **User Story 1 (P1)**: No dependencies - foundational auth
- **User Story 2 (P1)**: Requires US1 (need parent account to add children)
- **User Story 3 (P1)**: Requires US2 (need child accounts for funding)
- **User Story 4 (P1)**: Requires US2 (need child accounts for expenses)
- **User Story 5 (P2)**: Requires US1 (extends parent functionality)
- **User Story 6 (P2)**: Benefits from US4 (needs expense data) but can use mock data
- **User Story 7 (P3)**: Can start anytime after Foundational
- **User Story 8 (P3)**: Can start anytime after Foundational

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Models before services
- Backend before frontend
- Core implementation before UI polish
- Story complete before moving to next

### Parallel Opportunities

- All Setup tasks marked [P] can run simultaneously
- All Foundational tasks marked [P] can run simultaneously (after setup)
- Within each story, all [P] tasks can run in parallel
- P2 and P3 stories can run parallel to P1 stories after Foundational
- Different developers can work on different user stories

---

## Parallel Example: User Story 1

```bash
# Launch all tests together:
Task: T025 [P] [US1] Unit test for signup Lambda
Task: T026 [P] [US1] Unit test for email verification
Task: T027 [P] [US1] Integration test for auth flow
Task: T028 [P] [US1] Frontend test for SignupScreen
Task: T029 [P] [US1] Frontend test for auth service

# Launch all models together:
Task: T030 [P] [US1] Create ParentAccount model
Task: T031 [P] [US1] Create FamilyAccount model
Task: T032 [P] [US1] Create EmailVerification model

# Launch all frontend screens together:
Task: T038 [P] [US1] Create SignupScreen component
Task: T039 [P] [US1] Create LoginScreen component
Task: T040 [P] [US1] Create EmailVerificationScreen
Task: T041 [P] [US1] Create FamilySetupScreen
```

---

## Implementation Strategy

### MVP First (User Stories 1-4 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Parent Setup)
4. Complete Phase 4: User Story 2 (Child Accounts)
5. Complete Phase 5: User Story 3 (Funding)
6. Complete Phase 6: User Story 4 (Expenses)
7. **STOP and VALIDATE**: Test core functionality end-to-end
8. Deploy MVP if ready

### Incremental Delivery

1. Setup + Foundational → Infrastructure ready
2. Add User Story 1 → Parents can sign up (Demo point)
3. Add User Story 2 → Children can be added (Demo point)
4. Add User Story 3 → Allowances work (Demo point)
5. Add User Story 4 → Full MVP ready! (Major demo)
6. Add Stories 5-6 → Enhanced features (V2)
7. Add Stories 7-8 → Premium features (V3)

### Parallel Team Strategy

With multiple developers after Foundational:

**Team A (Core Flow)**:
- Developer 1: User Story 1 (Auth)
- Developer 2: User Story 2 (Children)

**Team B (Financial)**:
- Developer 3: User Story 3 (Funding)
- Developer 4: User Story 4 (Expenses)

**Team C (Enhancements)**:
- Developer 5: User Story 5-6 (Multi-parent, Analytics)
- Developer 6: User Story 7-8 (Offline, Notifications)

---

## Notes

- Total tasks: 145
- Setup tasks: 9
- Foundational tasks: 15
- Story tasks: ~15-20 per story
- Tests included per requirements (70%+ coverage target)
- Each phase delivers independently testable value
- Avoid starting new stories until current priority complete
- Commit after each task or logical group
- Run tests continuously during development
