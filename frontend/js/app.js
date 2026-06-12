// Main Application Entry Point
import { api, roundCents } from './api.js';
import { auth } from './auth.js';
import * as ui from './ui.js';
import { labels, applyLabels } from './labels.js';
import { removeExpense, insertExpense } from './expense_state.js';

// ---- Haptic feedback via capture-phase event delegation on .pin-pad ----
// auth.js owns the PIN pad buttons; we attach here in capture phase so we
// fire haptics without touching auth.js. Attached once at module evaluation
// time — before DOMContentLoaded is fine because the script is type="module"
// (deferred) so the DOM is already parsed.
(function wirePinHaptics() {
    // Runs after DOM is parsed (module scripts are deferred).
    function attach() {
        document.querySelectorAll('.pin-pad').forEach((pad) => {
            pad.addEventListener('pointerdown', (e) => {
                const key = e.target.closest('.pin-key');
                if (!key) return;
                ui.vibrate(10);
            }, { capture: true, passive: true });
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attach);
    } else {
        attach();
    }
}());

// localStorage key (per instance) for the last month the user viewed, so a
// relaunch reopens where they left off instead of always jumping to the
// latest month (review C3). Mirrors api.js's instance detection.
function detectInstance() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[0] === 'passbook') return parts[1];
    return parts[parts.length - 1] || 'default';
}
const LAST_MONTH_KEY = `passbook_last_month_${detectInstance()}`;

class App {
    constructor() {
        this.currentMonth = null;
        this.monthData = null;
        this.allExpenses = [];
        this.expensesCursor = null;
        this.editingExpenseId = null;
        // The "YYYY-MM-DD" date shown when the edit modal opened, so a save
        // only sends `date` when the user actually changed it.
        this.editingOriginalDate = null;
        // Per-month authoritative data cache (review C6). Revisiting a month
        // already in the cache skips the network; a mutation to a month
        // deletes its entry so the next view refetches fresh data.
        this.monthCache = new Map();
        // Cached months-list payload + a dirty flag. The list is only
        // refetched when a mutation has occurred since the last fetch
        // (review C6), so merely opening the menu doesn't hit the network.
        this.monthsListData = null;
        this.monthsListDirty = true;
        // De-dupes concurrent getMonths calls (e.g. double-tapping the menu).
        this.inflightMonths = null;
        // Holds a deferred (undo-pending) expense delete. The row is already
        // removed from the UI optimistically; the DELETE network call is held
        // until the undo toast expires. Shape:
        //   { month, expenseId, expense, index }
        // null when no delete is pending.
        this.pendingDelete = null;
    }

    async init() {
        applyLabels();
        try {
            // Skip the checkSetup() round trip when we already hold a session:
            // a valid token implies setup is done, so we go straight to loading
            // data and shave a request off the cold-start path (review C3).
            if (api.hasSession()) {
                auth.init(() => this.onAuthSuccess());
                ui.showScreen('main-screen');
                ui.showDashboardLoading();
                try {
                    await this.loadInitialData();
                } catch (e) {
                    // Session was rejected (401 already bounced us via the
                    // session-expired event) or the load failed. If we're
                    // still on the main screen, surface a retry.
                    if (!api.hasSession()) {
                        ui.showScreen('auth-screen');
                    } else {
                        ui.showDashboardError(() => this.onAuthSuccess());
                    }
                }
                this.bindEvents();
                this.registerServiceWorker();
                return;
            }

            // No session: determine whether to show setup or the PIN screen.
            const isSetup = await api.checkSetup();
            ui.showScreen(isSetup ? 'auth-screen' : 'setup-screen');
            auth.init(() => this.onAuthSuccess());
            this.bindEvents();
            this.registerServiceWorker();
        } catch (error) {
            console.error('Failed to initialize:', error);
            ui.showToast('Failed to connect to server', 'error');
            // Show auth screen anyway
            ui.showScreen('auth-screen');
            auth.init(() => this.onAuthSuccess());
            this.bindEvents();
            this.registerServiceWorker();
        }
    }

    /**
     * Registers the service worker (review C1). Defensive: registration is
     * skipped silently when unsupported or when running from a non-secure
     * context (file://), and a failed registration never blocks the app.
     * The SW path is RELATIVE so it works under the GitHub Pages subpath
     * (/passbook/<instance>/sw.js with scope /passbook/<instance>/).
     *
     * Fast-update flow (audit MEDIUM-1): registration.update() is called on
     * every page load and on visibilitychange→visible (PWA resume), throttled
     * to once per minute.  When a new SW activates and claims the page the
     * 'controllerchange' event fires; we reload ONCE (guarded by `refreshing`)
     * so the user gets fresh assets immediately rather than waiting up to ~24 h
     * for the browser's background-update heuristic.
     */
    registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;

        // Snapshot whether a controller existed before registration.  The
        // controllerchange handler uses this to skip a reload on first install
        // (where the controller goes from null → SW for the first time).
        const hadController = !!navigator.serviceWorker.controller;

        // Guard: reload at most once per controllerchange event to prevent loops.
        let refreshing = false;
        // Whether the user has been shown the update toast but ignored it; used
        // to reload on their next navigation-equivalent action (month switch).
        let pendingUpdateReload = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing || !hadController) return;
            refreshing = true;
            if (document.hidden) {
                // Page is invisible — reload silently; the user won't notice.
                window.location.reload();
                return;
            }
            // Page is visible: show a persistent action toast so the user can
            // choose when to pick up the update. Reuses the undo-toast mechanism
            // (showUndoToast) for the same action-button affordance.
            pendingUpdateReload = true;
            ui.showUndoToast({
                message: labels.app_updated_toast,
                actionText: labels.reload_action || 'Reload',
                durationMs: 60_000,   // persistent — 60s before auto-reload
                onUndo: () => {
                    pendingUpdateReload = false;
                    window.location.reload();
                },
                onExpire: () => {
                    // Auto-dismissed after timeout without user action: leave
                    // pendingUpdateReload=true so the next month switch reloads.
                },
            });
        });
        // Expose the pending flag so selectMonth can read it.
        this._pendingUpdateReload = () => pendingUpdateReload;
        this._consumeUpdateReload = () => { pendingUpdateReload = false; };

        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').then((registration) => {
                // If a waiting SW already exists (rare with skipWaiting, but
                // possible on a slow activate), nudge it to skip waiting.
                if (registration.waiting) {
                    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                }

                // Poll for updates on load.
                registration.update().catch(() => {});

                // Poll for updates on PWA resume (visibilitychange → visible),
                // throttled to at most once per minute.
                let lastUpdateCheck = Date.now();
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState !== 'visible') return;
                    const now = Date.now();
                    if (now - lastUpdateCheck < 60_000) return;
                    lastUpdateCheck = now;
                    registration.update().catch(() => {});
                });
            }).catch((err) => {
                console.warn('Service worker registration failed:', err);
            });
        });
    }

    async onAuthSuccess() {
        ui.showScreen('main-screen');
        ui.showDashboardLoading();
        try {
            await this.loadInitialData();
        } catch (error) {
            // Failed initial load must not leave a believable $0.00 dashboard
            // (review F3): show a visible error with a Retry that re-runs this.
            console.error('Failed to load initial data:', error);
            ui.showDashboardError(() => this.onAuthSuccess());
        }
    }

    async loadInitialData() {
        // Fire the months list and the target month in parallel rather than
        // serially (review C3). The target month is the last one the user
        // viewed (if still present) else the latest.
        const remembered = localStorage.getItem(LAST_MONTH_KEY);
        const monthsPromise = this.fetchMonths(true);

        // We need the months list to know which months exist before we can
        // safely pick the target, so await it, then pick + fetch the month.
        const data = await monthsPromise;
        const months = data.months || [];

        let target = null;
        if (months.length > 0) {
            const hasRemembered = remembered && months.some((m) => m.month === remembered);
            target = hasRemembered ? remembered : months[0].month;
        }

        const renderList = () => ui.renderMonthsList(
            months,
            target,
            (month) => this.selectMonth(month),
            data.next_cursor,
            (cursor) => this.loadMoreMonths(cursor)
        );

        if (target) {
            this.currentMonth = target;
            // Render the list and load the month concurrently so the menu is
            // ready the moment it's opened and the dashboard paints ASAP.
            renderList();
            await this.loadMonthView(target);
        } else {
            this.currentMonth = null;
            renderList();
            ui.showEmptyState();
        }
    }

    bindEvents() {
        // Add expense button — reset date to today, then show modal with hint.
        document.getElementById('add-expense-btn').addEventListener('click', () => {
            const dateInput = document.getElementById('expense-date');
            const todayStr = (() => {
                const n = new Date();
                return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
            })();
            if (dateInput) {
                dateInput.value = todayStr;
                dateInput.max = todayStr;
            }
            // Hint derives from date (today = current month here).
            ui.setExpenseMonthHint(this.currentMonth, false, todayStr);
            ui.showModal('expense-modal');
            document.getElementById('expense-amount').focus();
        });

        // Expense form
        document.getElementById('expense-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleAddExpense();
        });

        // Cancel expense
        document.getElementById('cancel-expense').addEventListener('click', () => {
            ui.closeModal('expense-modal');
        });

        // Edit expense form
        document.getElementById('edit-expense-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleEditExpense();
        });

        // Cancel edit expense
        document.getElementById('cancel-edit-expense').addEventListener('click', () => {
            ui.closeModal('edit-expense-modal');
            this.editingExpenseId = null;
            this.editingOriginalDate = null;
        });

        // Create month form
        document.getElementById('create-month-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleCreateMonth();
        });

        // New month button
        document.getElementById('new-month-btn').addEventListener('click', () => {
            ui.hideMenu();
            const input = document.getElementById('new-month-input');
            input.value = ui.getCurrentMonthKey();
            ui.showModal('create-month-modal');
        });

        // Cancel create month
        document.getElementById('cancel-create-month').addEventListener('click', () => {
            ui.closeModal('create-month-modal');
        });

        // Add funds button
        document.getElementById('add-funds-btn').addEventListener('click', () => {
            ui.showModal('add-funds-modal');
            document.getElementById('funds-amount').focus();
        });

        // Add funds form
        document.getElementById('add-funds-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleAddFunds();
        });

        // Cancel add funds
        document.getElementById('cancel-add-funds').addEventListener('click', () => {
            ui.closeModal('add-funds-modal');
        });

        // Modal backdrop click. The confirm-modal manages its own backdrop
        // dismissal (it must resolve its promise — review F1), so skip it here.
        document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
            const modal = backdrop.closest('.modal');
            if (modal.id === 'confirm-modal') return;
            backdrop.addEventListener('click', () => {
                ui.closeModal(modal.id);
                // Reset editing state if edit modal was closed
                if (modal.id === 'edit-expense-modal') {
                    this.editingExpenseId = null;
                    this.editingOriginalDate = null;
                }
            });
        });

        // Menu
        document.getElementById('menu-btn').addEventListener('click', () => {
            ui.showMenu();
            this.loadMonthsList();
        });

        document.getElementById('close-menu').addEventListener('click', () => {
            ui.hideMenu();
        });

        document.getElementById('menu-overlay').addEventListener('click', () => {
            ui.hideMenu();
        });

        // Logout
        document.getElementById('logout-btn').addEventListener('click', () => {
            auth.logout();
        });

        // Change PIN
        document.getElementById('change-pin-btn').addEventListener('click', () => {
            ui.hideMenu();
            ui.showModal('change-pin-modal');
            document.getElementById('current-pin').focus();
        });

        document.getElementById('change-pin-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleChangePin();
        });

        document.getElementById('cancel-change-pin').addEventListener('click', () => {
            this.closeChangePinModal();
        });

        // Show/hide PIN toggle buttons
        document.querySelectorAll('.btn-show-pin').forEach(btn => {
            btn.addEventListener('click', () => {
                const input = document.getElementById(btn.dataset.target);
                if (input) {
                    const isPassword = input.type === 'password';
                    input.type = isPassword ? 'text' : 'password';
                    btn.querySelector('.icon-eye').classList.toggle('hidden', isPassword);
                    btn.querySelector('.icon-eye-off').classList.toggle('hidden', !isPassword);
                }
            });
        });

        // Auto-clear form errors when user starts typing
        ['expense-amount', 'expense-desc'].forEach(id =>
            document.getElementById(id).addEventListener('input', () => ui.hideError('expense-error')));
        ['edit-expense-amount', 'edit-expense-desc'].forEach(id =>
            document.getElementById(id).addEventListener('input', () => ui.hideError('edit-expense-error')));
        document.getElementById('new-month-input').addEventListener('input', () => ui.hideError('create-month-error'));
        document.getElementById('funds-amount').addEventListener('input', () => ui.hideError('add-funds-error'));

        // Date input: update the month hint dynamically as the user changes the
        // date, and clear the future-date error when they correct the value.
        const expenseDateInput = document.getElementById('expense-date');
        if (expenseDateInput) {
            expenseDateInput.addEventListener('change', () => {
                ui.hideError('expense-error');
                ui.setExpenseMonthHint(this.currentMonth, false, expenseDateInput.value || null);
            });
        }

        // Edit-date input: show the move hint when the chosen date's month
        // differs from the expense's current month, and clear errors on change.
        const editDateInput = document.getElementById('edit-expense-date');
        if (editDateInput) {
            editDateInput.addEventListener('change', () => {
                ui.hideError('edit-expense-error');
                ui.setEditExpenseMonthHint(this.currentMonth, editDateInput.value || null);
            });
        }

        // Haptics for PIN error/lockout: observe when the .error class is added
        // to any .pin-dot (auth.js calls ui.showPinError which adds that class).
        // This avoids touching auth.js while still reacting to its DOM changes.
        const pinDisplays = document.querySelectorAll('.pin-display');
        pinDisplays.forEach((display) => {
            new MutationObserver((mutations) => {
                for (const mut of mutations) {
                    if (mut.type === 'attributes' && mut.attributeName === 'class') {
                        const target = /** @type {Element} */ (mut.target);
                        if (target.classList.contains('error')) {
                            ui.vibrate([40, 60, 40]);
                            return;
                        }
                    }
                }
            }).observe(display, { subtree: true, attributes: true, attributeFilter: ['class'] });
        });

        // Haptics for PIN success: observe when the auth-screen becomes hidden
        // (auth.js calls ui.showScreen which hides auth-screen on success).
        const authScreen = document.getElementById('auth-screen');
        if (authScreen) {
            new MutationObserver(() => {
                if (authScreen.classList.contains('hidden')) {
                    ui.vibrate([10, 30, 10]);
                }
            }).observe(authScreen, { attributes: true, attributeFilter: ['class'] });
        }

        // Escape key closes the topmost visible modal AND resets its form/error
        // (via closeModal) so a backdrop/Escape dismissal doesn't leave stale
        // state behind (review F6). The confirm-modal is skipped here because
        // showConfirm owns its own Escape handling so its promise resolves
        // (review F1); handling it here too would double-close.
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            const visibleModal = Array.from(document.querySelectorAll('.modal'))
                .reverse()
                .find(m => !m.classList.contains('hidden') && m.id !== 'confirm-modal');
            if (!visibleModal) return;
            if (visibleModal.id === 'change-pin-modal') {
                this.closeChangePinModal();
            } else {
                ui.closeModal(visibleModal.id);
            }
            if (visibleModal.id === 'edit-expense-modal') {
                this.editingExpenseId = null;
                this.editingOriginalDate = null;
            }
        });

        // Pull-to-refresh on the main screen (touch only).
        this.setupPullToRefresh();

        // Edge (b): a pending (undo-deferred) delete must not be lost if the
        // page is hidden/closed before the toast expires. fetch keepalive lets
        // the DELETE complete during unload. visibilitychange→hidden is the
        // reliable mobile signal (app switch / lock); pagehide covers desktop
        // close/navigation. Both are idempotent — flushPendingDelete no-ops once
        // the record is cleared.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') this.flushPendingDelete();
        });
        window.addEventListener('pagehide', () => this.flushPendingDelete());

        // Session expired: close every modal, re-enable any disabled submit
        // buttons (so the user doesn't return to an action-frozen UI after
        // re-auth), then bounce to the PIN screen.
        window.addEventListener('session-expired', () => {
            document.querySelectorAll('.modal:not(.hidden)').forEach(m => ui.hideModal(m.id));
            document.querySelectorAll('button[type="submit"]').forEach(btn => {
                btn.disabled = false;
            });
            this.editingExpenseId = null;
            this.editingOriginalDate = null;
            ui.showToast('Session expired. Please log in again.', 'error');
            ui.showScreen('auth-screen');
        });
    }

    // --- Data loading ---

    /**
     * Returns the expense-list callback object used by renderExpenses.
     * Centralised here so loadCurrentMonth, loadMonthView, and loadMoreExpenses
     * all share a single definition.
     * @returns {Object} Callbacks object for use with ui.renderExpenses
     */
    expenseCallbacks() {
        return {
            onDelete: (id) => this.handleDeleteExpense(id),
            onEdit: (id, amount, desc) => this.openEditExpense(id, amount, desc),
            onLoadMore: (nextCursor) => this.loadMoreExpenses(nextCursor),
        };
    }

    /**
     * Fetches the first page of the months list, de-duping concurrent calls
     * and caching the result. Clears the dirty flag on success.
     * @param {boolean} [force=false] - bypass the cache even if not dirty
     * @returns {Promise<Object>} the months-list payload
     */
    async fetchMonths(force = false) {
        if (!force && !this.monthsListDirty && this.monthsListData) {
            return this.monthsListData;
        }
        // Collapse a burst of callers (e.g. menu double-tap) onto one request.
        if (this.inflightMonths) return this.inflightMonths;
        this.inflightMonths = (async () => {
            try {
                const data = await api.getMonths();
                this.monthsListData = data;
                this.monthsListDirty = false;
                return data;
            } finally {
                this.inflightMonths = null;
            }
        })();
        return this.inflightMonths;
    }

    /**
     * Renders the given month onto the dashboard. Serves from the per-month
     * cache when available (review C6); otherwise fetches. Guards against the
     * month-switch race (review F2): if the user switched months again while
     * the fetch was in flight, the stale result is discarded.
     * @param {string} month - "YYYY-MM" month key
     */
    async loadMonthView(month) {
        this.currentMonth = month;

        const cached = this.monthCache.get(month);
        if (cached) {
            this.applyMonthData(month, cached);
            return;
        }

        const data = await api.getMonth(month);
        // Bail if the user switched months while we awaited (review F2):
        // rendering month A's data while currentMonth is B would desync the
        // dashboard and send later edits to the wrong month.
        if (month !== this.currentMonth) return;

        this.monthCache.set(month, data);
        this.applyMonthData(month, data);
    }

    /**
     * Applies an already-fetched month payload to in-memory state, the
     * dashboard, the expense list, and the remembered-last-month store.
     * @param {string} month
     * @param {Object} data - MonthDataResponse
     */
    applyMonthData(month, data) {
        this.monthData = data;
        this.allExpenses = data.expenses || [];
        this.expensesCursor = data.next_cursor || null;
        try { localStorage.setItem(LAST_MONTH_KEY, month); } catch { /* private mode */ }
        ui.updateDashboard(data);
        ui.renderExpenses(this.allExpenses, this.expenseCallbacks(), this.expensesCursor);
    }

    async loadCurrentMonth() {
        try {
            await this.loadMonthView(this.currentMonth);
        } catch (error) {
            console.error('Failed to load month data:', error);
            throw error;
        }
    }

    async loadMonthsList() {
        try {
            const data = await this.fetchMonths();
            ui.renderMonthsList(
                data.months,
                this.currentMonth,
                (month) => this.selectMonth(month),
                data.next_cursor,
                (cursor) => this.loadMoreMonths(cursor)
            );
        } catch (error) {
            console.error('Failed to load months list:', error);
            ui.showToast('Failed to load history', 'error');
        }
    }

    /**
     * Invalidates cached state after a mutation to the given month: drops the
     * month's cached data and marks the months list dirty so both refetch
     * authoritative data on next view (review C4/H1/C6).
     * @param {string} month
     */
    invalidateMonth(month) {
        if (month) this.monthCache.delete(month);
        this.monthsListDirty = true;
        this.monthsListData = null;
    }

    async loadMoreExpenses(cursor) {
        try {
            const data = await api.getMonth(this.currentMonth, cursor);
            this.allExpenses = [...this.allExpenses, ...(data.expenses || [])];
            this.expensesCursor = data.next_cursor || null;

            ui.renderExpenses(this.allExpenses, this.expenseCallbacks(), this.expensesCursor);
        } catch (error) {
            ui.showToast('Failed to load more expenses', 'error');
        }
    }

    async loadMoreMonths(cursor) {
        try {
            const data = await api.getMonths(cursor);
            // Append to existing months list. The load-more control is now a
            // <button> (inside its <li>); remove the whole list item.
            const container = document.getElementById('months-list');
            const loadMoreBtn = document.getElementById('load-more-months');
            if (loadMoreBtn) loadMoreBtn.closest('li').remove();

            // Scale the appended page's spend bars by its own max. Bars are a
            // per-page relative cue; mixing scales across pages isn't worth a
            // full re-render of already-painted rows.
            const maxExpenses = ui.maxMonthExpenses(data.months);
            for (const month of data.months) {
                container.appendChild(
                    ui.buildMonthRow(month, this.currentMonth, (m) => this.selectMonth(m), maxExpenses)
                );
            }

            if (data.next_cursor) {
                container.appendChild(
                    ui.buildLoadMoreMonthsItem(() => this.loadMoreMonths(data.next_cursor))
                );
            }
        } catch (error) {
            ui.showToast('Failed to load more months', 'error');
        }
    }

    /**
     * Full refresh triggered by pull-to-refresh: commit any pending delete,
     * invalidate the current month + months-list caches, then refetch both and
     * re-render. Resolves when the refetch settles (success or handled error)
     * so the PTR indicator can retract.
     */
    async refreshCurrentView() {
        // A pull-to-refresh is a navigation-like action; commit any pending
        // delete so it isn't lost when caches are invalidated/refetched.
        ui.flushUndoToast();
        try {
            this.monthsListDirty = true;
            this.monthsListData = null;
            if (this.currentMonth) {
                this.monthCache.delete(this.currentMonth);
                // Refetch the months list and the current month in parallel.
                const [data] = await Promise.all([
                    this.fetchMonths(true),
                    this.loadMonthView(this.currentMonth),
                ]);
                ui.renderMonthsList(
                    data.months,
                    this.currentMonth,
                    (m) => this.selectMonth(m),
                    data.next_cursor,
                    (cursor) => this.loadMoreMonths(cursor)
                );
            } else {
                await this.loadInitialData();
            }
        } catch (error) {
            ui.showToast('Failed to refresh', 'error');
        }
    }

    /**
     * Wires touch-based pull-to-refresh on the main screen. Active only when
     * the page is scrolled to the top; pulling down past a threshold and
     * releasing triggers refreshCurrentView(). The indicator is positioned via
     * the CSSOM --pull property (CSP-safe). Kept deliberately physics-free:
     * the indicator simply follows the (damped) drag distance.
     */
    setupPullToRefresh() {
        const screen = document.getElementById('main-screen');
        const indicator = document.getElementById('ptr-indicator');
        if (!screen || !indicator) return;

        const THRESHOLD = 70;   // px pull past which a release refreshes
        const MAX_PULL = 110;   // px the indicator stops following at
        let startY = 0;
        let pulling = false;     // a qualifying pull is in progress
        let refreshing = false;  // a refresh is running; ignore new pulls

        const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0;

        const reset = () => {
            pulling = false;
            indicator.style.setProperty('--pull', '0px');
            indicator.classList.remove('ptr-armed', 'ptr-visible');
        };

        screen.addEventListener('touchstart', (e) => {
            // Single-finger pulls only; never while a modal/menu is open (they
            // own their own scroll) or mid-refresh.
            if (refreshing || e.touches.length !== 1) return;
            if (!atTop()) return;
            if (document.querySelector('.modal:not(.hidden)') ||
                !document.getElementById('history-menu').classList.contains('hidden')) return;
            startY = e.touches[0].clientY;
            pulling = true;
        }, { passive: true });

        screen.addEventListener('touchmove', (e) => {
            if (!pulling || refreshing) return;
            // If the user scrolled away from the top mid-gesture, abandon.
            if (!atTop()) { reset(); return; }
            const delta = e.touches[0].clientY - startY;
            if (delta <= 0) {
                // Upward/neutral: not a pull. Let normal scrolling proceed.
                indicator.style.setProperty('--pull', '0px');
                indicator.classList.remove('ptr-visible', 'ptr-armed');
                return;
            }
            // Damp the drag so it feels rubber-banded and never runs away.
            const pull = Math.min(delta * 0.5, MAX_PULL);
            indicator.style.setProperty('--pull', `${pull}px`);
            indicator.classList.add('ptr-visible');
            indicator.classList.toggle('ptr-armed', pull >= THRESHOLD);
            // Once we're clearly pulling, suppress native scroll/overscroll so
            // the gesture doesn't double as a page scroll.
            if (e.cancelable && pull > 4) e.preventDefault();
        }, { passive: false });

        const onEnd = () => {
            if (!pulling || refreshing) { if (!refreshing) reset(); return; }
            const armed = indicator.classList.contains('ptr-armed');
            if (!armed) { reset(); return; }
            // Trigger the refresh: pin the indicator at the threshold and spin.
            refreshing = true;
            pulling = false;
            indicator.classList.add('ptr-refreshing', 'ptr-visible');
            indicator.style.setProperty('--pull', `${THRESHOLD}px`);
            this.refreshCurrentView().finally(() => {
                refreshing = false;
                indicator.classList.remove('ptr-refreshing');
                reset();
            });
        };
        screen.addEventListener('touchend', onEnd, { passive: true });
        screen.addEventListener('touchcancel', () => { if (!refreshing) reset(); }, { passive: true });
    }

    async selectMonth(month) {
        ui.hideMenu();
        // Edge (c): a month switch must commit any pending delete first so it
        // isn't silently abandoned. flushUndoToast() settles the visible undo
        // toast as an expiry, which runs commitPendingDelete().
        ui.flushUndoToast();

        // Feature 2: if a SW update toast was dismissed without action, reload
        // on the next navigation-equivalent action (month switch) so the user
        // eventually picks up fresh assets without a jarring reload mid-session.
        if (this._pendingUpdateReload && this._pendingUpdateReload()) {
            this._consumeUpdateReload();
            window.location.reload();
            return;
        }

        try {
            await this.loadMonthView(month);
        } catch {
            ui.showToast('Failed to load month data', 'error');
        }
    }

    // --- Expense handlers ---

    async handleAddExpense() {
        const amountInput = document.getElementById('expense-amount');
        const descInput = document.getElementById('expense-desc');
        const dateInput = document.getElementById('expense-date');
        const amount = roundCents(parseFloat(amountInput.value));
        const description = descInput.value.trim();
        // dateInput.value is "" when the field has no value or is unsupported.
        const chosenDate = (dateInput && dateInput.value) ? dateInput.value : null;

        ui.hideError('expense-error');

        if (isNaN(amount) || amount <= 0) {
            ui.showError('expense-error', 'Please enter a valid amount');
            return;
        }

        if (amount > 99999.99) {
            ui.showError('expense-error', 'Amount cannot exceed $99,999.99');
            return;
        }

        if (!description) {
            ui.showError('expense-error', 'Please enter a description');
            return;
        }

        // Client-side future-date guard (YYYY-MM-DD string comparison is safe
        // for ISO dates as long as we compare against today's LOCAL date).
        if (chosenDate) {
            const todayStr = (() => {
                const n = new Date();
                return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
            })();
            if (chosenDate > todayStr) {
                ui.showError('expense-error', labels.expense_date_future);
                return;
            }
        }

        const submitBtn = document.querySelector('#expense-form button[type="submit"]');
        const origText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        // Derive the target month from the chosen date when provided; otherwise
        // fall back to the current local month (original behaviour).
        let targetMonth;
        if (chosenDate) {
            const m = chosenDate.match(/^(\d{4}-\d{2})/);
            targetMonth = m ? m[1] : ui.getCurrentMonthKey();
        } else {
            targetMonth = ui.getCurrentMonthKey();
        }

        try {
            await api.addExpense(amount, description, chosenDate || null);
            ui.closeModal('expense-modal');
            ui.showToast('Expense added!', 'success');
            ui.vibrate(15);

            // The mutation changed the target month (and possibly created it),
            // so its cache and the months list are now stale (review C4/H1).
            this.invalidateMonth(targetMonth);

            if (targetMonth === this.currentMonth) {
                // Refetch the authoritative month (a fresh GET keeps
                // starting_balance / carry correct after the mutation).
                await this.loadCurrentMonth();
            } else {
                // Month rollover or past-date entry: the expense landed in a
                // different month than the one being viewed. Switch the view to
                // the target month so the user sees their entry, and refresh
                // the months list so the (possibly new) month appears.
                this.currentMonth = targetMonth;
                await this.loadMonthView(targetMonth);
                await this.loadMonthsList();
            }
        } catch (error) {
            ui.showError('expense-error', error.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = origText;
        }
    }

    openEditExpense(expenseId, amount, description) {
        this.editingExpenseId = expenseId;
        // Prefill the date from the expense's existing timestamp so it matches
        // the day shown in the list. created_at is an ISO instant; new Date()
        // renders it in LOCAL time, same as the list's day grouping, so the
        // prefilled YYYY-MM-DD is the local calendar day the user sees.
        const expense = this.allExpenses.find((e) => e.id === expenseId);
        let dateStr = null;
        if (expense && expense.created_at) {
            const d = new Date(expense.created_at);
            if (!isNaN(d.getTime())) {
                dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            }
        }
        // Remember the originally-shown date so we only send `date` when it
        // actually changed (an unchanged date must not re-key the SK).
        this.editingOriginalDate = dateStr;
        ui.populateEditExpenseModal(amount, description, dateStr);
        // Hint compares the chosen date's month against the expense's current
        // month; on open they match, so it starts hidden.
        ui.setEditExpenseMonthHint(this.currentMonth, dateStr);
    }

    async handleEditExpense() {
        const amountInput = document.getElementById('edit-expense-amount');
        const descInput = document.getElementById('edit-expense-desc');
        const dateInput = document.getElementById('edit-expense-date');
        const amount = roundCents(parseFloat(amountInput.value));
        const description = descInput.value.trim();
        const chosenDate = (dateInput && dateInput.value) ? dateInput.value : null;

        ui.hideError('edit-expense-error');

        if (isNaN(amount) || amount <= 0) {
            ui.showError('edit-expense-error', 'Please enter a valid amount');
            return;
        }

        if (amount > 99999.99) {
            ui.showError('edit-expense-error', 'Amount cannot exceed $99,999.99');
            return;
        }

        if (!description) {
            ui.showError('edit-expense-error', 'Please enter a description');
            return;
        }

        // Client-side future-date guard, mirroring the add path: compare the
        // chosen ISO date string against today's LOCAL date.
        if (chosenDate) {
            const todayStr = (() => {
                const n = new Date();
                return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
            })();
            if (chosenDate > todayStr) {
                ui.showError('edit-expense-error', labels.expense_date_future);
                return;
            }
        }

        const submitBtn = document.querySelector('#edit-expense-form button[type="submit"]');
        const origText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        const editMonth = this.currentMonth;
        const editId = this.editingExpenseId;
        // Send `date` only when it actually changed from what was shown on open;
        // an unchanged date leaves the timestamp/SK untouched on the backend.
        const dateChanged = !!(chosenDate && chosenDate !== this.editingOriginalDate);

        try {
            const res = await api.updateExpense(editMonth, editId, amount, description, dateChanged ? chosenDate : null);
            ui.closeModal('edit-expense-modal');
            this.editingExpenseId = null;
            this.editingOriginalDate = null;

            // A move happened iff the response's month differs from the month
            // being viewed. The cross-month path touches BOTH months' summaries
            // and the months list, so an in-place patch isn't enough — drop both
            // caches + the list and refetch the viewed month authoritatively.
            const movedTo = res.expense && res.expense.month;
            if (movedTo && movedTo !== editMonth) {
                this.invalidateMonth(editMonth);
                this.invalidateMonth(movedTo);
                await this.loadCurrentMonth();
                ui.showToast(
                    labels.expense_moved_to_toast.replace('{month}', ui.formatMonthName(movedTo)),
                    'success');
            } else {
                ui.showToast('Expense updated!', 'success');
                // Same-month edit (amount/description, or a same-month re-date):
                // apply the response in place, then drop the month's cache so a
                // later revisit refetches authoritative summary fields. A
                // same-month re-date can re-key the SK, so the original id is
                // passed so applyExpenseUpdate can locate the row by it.
                this.applyExpenseUpdate(editMonth, res, editId);
                this.invalidateMonth(editMonth);
            }
        } catch (error) {
            ui.showError('edit-expense-error', error.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = origText;
        }
    }

    /**
     * Updates the in-memory month state from an updateExpense response and
     * re-renders, without a refetch. No-ops if the user navigated away. Only
     * handles SAME-month responses (a cross-month move is handled by a refetch
     * in handleEditExpense). A same-month re-date can re-key the SK and change
     * created_at, so the row's id/created_at/order are reconciled, not just its
     * amount/description; `originalId` locates the row when its SK changed.
     * @param {string} month
     * @param {Object} res - UpdateExpenseResponse { expense, total_balance }
     * @param {string} [originalId] - the SK the row had before this edit
     */
    applyExpenseUpdate(month, res, originalId) {
        if (month !== this.currentMonth || !this.monthData) return;
        const updated = res.expense;
        if (updated) {
            // Match by the updated id first (amount/description-only edit keeps
            // the same SK); fall back to the original id when a same-month
            // re-date re-keyed the SK.
            let idx = this.allExpenses.findIndex((e) => e.id === updated.id);
            if (idx === -1 && originalId) {
                idx = this.allExpenses.findIndex((e) => e.id === originalId);
            }
            if (idx !== -1) {
                const prev = this.allExpenses[idx];
                const prevAmount = parseFloat(prev.amount) || 0;
                const newAmount = parseFloat(updated.amount) || 0;
                this.allExpenses[idx] = { ...prev, ...updated };
                // Keep summary.total_expenses and summary.ending_balance
                // consistent with the row change.
                if (this.monthData.summary) {
                    const delta = newAmount - prevAmount;
                    this.monthData.summary.total_expenses = roundCents(
                        (this.monthData.summary.total_expenses || 0) + delta);
                    if (this.monthData.summary.ending_balance !== undefined) {
                        this.monthData.summary.ending_balance = roundCents(
                            (this.monthData.summary.ending_balance || 0) - delta);
                    }
                }
                // A re-date changes created_at, which drives the list's
                // newest-first order and day grouping; re-sort so the row lands
                // on its new day (descending by created_at, matching the API).
                this.allExpenses.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            }
        }
        if (typeof res.total_balance === 'number') {
            this.monthData.total_balance = res.total_balance;
        }
        ui.updateDashboard(this.monthData);
        ui.renderExpenses(this.allExpenses, this.expenseCallbacks(), this.expensesCursor);
    }

    /**
     * Optimistic, DEFERRED delete: the row disappears immediately and the
     * DELETE network call is held until the undo toast expires (5s). Undo
     * cancels the pending call and restores the row. A second delete while one
     * is pending flushes (fires) the first immediately, then defers the second.
     * @param {string} expenseId
     */
    handleDeleteExpense(expenseId) {
        // Edge (a): a delete while another is pending → commit the pending one
        // now (normal awaited DELETE with full error handling), then start the
        // new one fresh. flushUndoToast settles the old toast and runs its
        // onExpire → commitPendingDelete.
        if (this.pendingDelete) ui.flushUndoToast();

        const delMonth = this.currentMonth;
        if (!this.monthData) return;
        // Mutate the live in-memory month through the pure helper. `summary` is
        // a shared object reference (nested mutations land on monthData); only
        // total_balance is a scalar, so sync it back after.
        const state = this.monthStateShim();
        const removal = removeExpense(state, expenseId);
        if (!removal) return; // already gone / navigated away
        this.monthData.total_balance = state.total_balance;

        // Re-render the optimistic state.
        ui.updateDashboard(this.monthData);
        ui.renderExpenses(this.allExpenses, this.expenseCallbacks(), this.expensesCursor);

        this.pendingDelete = {
            month: delMonth,
            expenseId,
            expense: removal.expense,
            index: removal.index,
        };

        ui.showUndoToast({
            message: labels.expense_deleted_undo,
            actionText: labels.undo_action,
            durationMs: 5000,
            onUndo: () => this.undoPendingDelete(),
            onExpire: () => this.commitPendingDelete(),
        });
    }

    /**
     * Returns a plain state object the pure helpers (removeExpense /
     * insertExpense) can mutate. `expenses` aliases this.allExpenses (same
     * array reference) and `summary` aliases this.monthData.summary (same
     * object), so their in-place mutations land on the live model. Only the
     * scalar `total_balance` is a copy — callers sync it back afterwards.
     * @returns {Object}
     */
    monthStateShim() {
        return {
            expenses: this.allExpenses,
            summary: this.monthData.summary,
            total_balance: this.monthData.total_balance,
        };
    }

    /**
     * Fires the deferred DELETE for the currently-pending delete (if any) and
     * clears the pending record. The optimistic UI already reflects the removal,
     * so on success we just invalidate caches; on failure we restore the row and
     * surface the existing error toast (edge d).
     */
    commitPendingDelete() {
        const pending = this.pendingDelete;
        if (!pending) return;
        this.pendingDelete = null;
        this.invalidateMonth(pending.month);
        api.deleteExpense(pending.month, pending.expenseId).catch(() => {
            this.restoreDeletedExpense(pending);
            ui.showToast('Failed to delete expense', 'error');
        });
    }

    /**
     * Synchronous flush used when the page is being torn down or before a
     * navigation that can't await: fires the DELETE with keepalive so it
     * survives unload. Clears the pending record immediately.
     */
    flushPendingDelete() {
        const pending = this.pendingDelete;
        if (!pending) return;
        this.pendingDelete = null;
        this.invalidateMonth(pending.month);
        api.deleteExpenseKeepalive(pending.month, pending.expenseId);
    }

    /**
     * Cancels a pending delete and restores the expense locally (re-insert into
     * the in-memory month, re-render, fix summary/total_balance back).
     */
    undoPendingDelete() {
        const pending = this.pendingDelete;
        if (!pending) return;
        this.pendingDelete = null;
        this.restoreDeletedExpense(pending);
    }

    /**
     * Re-inserts a previously-removed expense into the live month state and
     * re-renders. No-ops (beyond cache invalidation) if the user navigated to a
     * different month, since the row belongs to `pending.month`.
     * @param {Object} pending - { month, expense, index }
     */
    restoreDeletedExpense(pending) {
        if (pending.month !== this.currentMonth || !this.monthData) {
            // The month it belonged to is no longer on screen; its cache was
            // invalidated so a revisit refetches authoritative data.
            this.invalidateMonth(pending.month);
            return;
        }
        const state = this.monthStateShim();
        insertExpense(state, pending.expense, pending.index);
        this.monthData.total_balance = state.total_balance;
        ui.updateDashboard(this.monthData);
        ui.renderExpenses(this.allExpenses, this.expenseCallbacks(), this.expensesCursor);
    }

    // --- Month management handlers ---

    async handleCreateMonth() {
        const monthInput = document.getElementById('new-month-input');
        // Normalize: type="month" degrades to a text box on desktop
        // Safari/Firefox, where a user may type "2026-6". Pad the month part
        // to two digits so it matches the backend's YYYY-MM contract (review
        // Low/F-input).
        const month = normalizeMonthKey(monthInput.value);

        ui.hideError('create-month-error');

        if (!month) {
            ui.showError('create-month-error', 'Please enter a valid month (YYYY-MM)');
            return;
        }
        monthInput.value = month;

        const submitBtn = document.querySelector('#create-month-form button[type="submit"]');
        const origText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating...';

        try {
            await api.createMonth(month);
            ui.closeModal('create-month-modal');
            ui.showToast('Month created!', 'success');
            // A new month changes the list and (if now the latest) the view.
            this.invalidateMonth(month);
            await this.loadInitialData();
        } catch (error) {
            ui.showError('create-month-error', error.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = origText;
        }
    }

    async handleAddFunds() {
        const amountInput = document.getElementById('funds-amount');
        const amount = roundCents(parseFloat(amountInput.value));

        ui.hideError('add-funds-error');

        if (isNaN(amount) || amount <= 0) {
            ui.showError('add-funds-error', 'Please enter a valid amount');
            return;
        }

        if (amount > 99999.99) {
            ui.showError('add-funds-error', 'Amount cannot exceed $99,999.99');
            return;
        }

        if (!this.currentMonth) {
            ui.showError('add-funds-error', 'No month selected');
            return;
        }

        const submitBtn = document.querySelector('#add-funds-form button[type="submit"]');
        const origText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Adding...';

        const fundsMonth = this.currentMonth;

        try {
            const res = await api.addFunds(fundsMonth, amount);
            ui.closeModal('add-funds-modal');
            ui.showToast(labels.funds_added_toast, 'success');

            // addFunds returns the full updated summary + total_balance, so
            // apply it in place rather than refetching (review C4/H1).
            this.applyFundsUpdate(fundsMonth, res);
            this.invalidateMonth(fundsMonth);
        } catch (error) {
            ui.showError('add-funds-error', error.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = origText;
        }
    }

    /**
     * Applies an addFunds response (full summary + total_balance) to the
     * in-memory month and re-renders without a refetch. No-ops if the user
     * navigated away.
     * @param {string} month
     * @param {Object} res - AddFundsResponse { summary, total_balance }
     */
    applyFundsUpdate(month, res) {
        if (month !== this.currentMonth || !this.monthData) return;
        if (res.summary) this.monthData.summary = res.summary;
        if (typeof res.total_balance === 'number') this.monthData.total_balance = res.total_balance;
        ui.updateDashboard(this.monthData);
    }

    // --- PIN management ---

    async handleChangePin() {
        const currentPin = document.getElementById('current-pin').value;
        const newPin = document.getElementById('new-pin').value;
        const confirmPin = document.getElementById('confirm-pin').value;
        const submitBtn = document.querySelector('#change-pin-form button[type="submit"]');
        const originalText = submitBtn.textContent;

        ui.hideError('change-pin-error');

        if (!/^\d{4,6}$/.test(newPin)) {
            ui.showError('change-pin-error', 'New PIN must be 4-6 digits');
            return;
        }

        if (newPin !== confirmPin) {
            ui.showError('change-pin-error', 'New PINs do not match');
            return;
        }

        // Show loading state
        submitBtn.disabled = true;
        submitBtn.textContent = 'Changing...';

        try {
            await api.changePin(currentPin, newPin);
            this.closeChangePinModal();
            ui.showToast('PIN changed successfully!', 'success');
        } catch (error) {
            ui.showError('change-pin-error', error.message);
        } finally {
            // Reset button state
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    }

    /**
     * Closes the change-PIN modal: resets the form, clears the error, and
     * resets every show/hide-PIN toggle back to the hidden (password) state so
     * the next open doesn't reveal a previously-shown field.
     */
    closeChangePinModal() {
        ui.closeModal('change-pin-modal');
        document.querySelectorAll('.btn-show-pin').forEach(btn => {
            const input = document.getElementById(btn.dataset.target);
            if (input) input.type = 'password';
            btn.querySelector('.icon-eye').classList.remove('hidden');
            btn.querySelector('.icon-eye-off').classList.add('hidden');
        });
    }
}

/**
 * Normalizes a user-entered month string to the backend's "YYYY-MM" contract.
 * `type="month"` already yields that format, but it degrades to a text box on
 * desktop Safari/Firefox where a user might type "2026-6" or "2026-06".
 * Returns the normalized key, or null if it isn't a valid year-month.
 * @param {string} value
 * @returns {string|null}
 */
function normalizeMonthKey(value) {
    if (!value) return null;
    const m = String(value).trim().match(/^(\d{4})-(\d{1,2})$/);
    if (!m) return null;
    const month = parseInt(m[2], 10);
    if (month < 1 || month > 12) return null;
    return `${m[1]}-${String(month).padStart(2, '0')}`;
}

// Initialize app when DOM is ready
const app = new App();
document.addEventListener('DOMContentLoaded', () => app.init());
