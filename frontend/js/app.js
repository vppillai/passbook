// Main Application Entry Point
import { api, roundCents } from './api.js';
import { auth } from './auth.js';
import * as ui from './ui.js';
import { labels, applyLabels } from './labels.js';

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
     */
    registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').catch((err) => {
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
        // Add expense button
        document.getElementById('add-expense-btn').addEventListener('click', () => {
            // When viewing a past month, hint that the expense will land in the
            // current month, not the one on screen (review H5/FAB-on-old-month).
            const current = ui.getCurrentMonthKey();
            ui.setExpenseMonthHint(current, this.currentMonth !== null && this.currentMonth !== current);
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
            if (visibleModal.id === 'edit-expense-modal') this.editingExpenseId = null;
        });

        // Session expired: close every modal, re-enable any disabled submit
        // buttons (so the user doesn't return to an action-frozen UI after
        // re-auth), then bounce to the PIN screen.
        window.addEventListener('session-expired', () => {
            document.querySelectorAll('.modal:not(.hidden)').forEach(m => ui.hideModal(m.id));
            document.querySelectorAll('button[type="submit"]').forEach(btn => {
                btn.disabled = false;
            });
            this.editingExpenseId = null;
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

            for (const month of data.months) {
                container.appendChild(
                    ui.buildMonthRow(month, this.currentMonth, (m) => this.selectMonth(m))
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

    async selectMonth(month) {
        ui.hideMenu();
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
        const amount = roundCents(parseFloat(amountInput.value));
        const description = descInput.value.trim();

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

        const submitBtn = document.querySelector('#expense-form button[type="submit"]');
        const origText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        // The expense always lands in the user's CURRENT local month, which
        // may differ from the month being viewed (review H5/FAB-on-old-month).
        const targetMonth = ui.getCurrentMonthKey();

        try {
            await api.addExpense(amount, description);
            ui.closeModal('expense-modal');
            ui.showToast('Expense added!', 'success');

            // The mutation changed the target month (and possibly created it),
            // so its cache and the months list are now stale (review C4/H1).
            this.invalidateMonth(targetMonth);

            if (targetMonth === this.currentMonth) {
                // Refetch the authoritative month (a fresh GET keeps
                // starting_balance / carry correct after the mutation).
                await this.loadCurrentMonth();
            } else {
                // Month rollover: the expense landed in a different month than
                // the one being viewed (e.g. adding from an old month, or the
                // server auto-created the new current month). Switch the view
                // to the target month so the user sees their entry, and refresh
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
        ui.populateEditExpenseModal(amount, description);
    }

    async handleEditExpense() {
        const amountInput = document.getElementById('edit-expense-amount');
        const descInput = document.getElementById('edit-expense-desc');
        const amount = roundCents(parseFloat(amountInput.value));
        const description = descInput.value.trim();

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

        const submitBtn = document.querySelector('#edit-expense-form button[type="submit"]');
        const origText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        const editMonth = this.currentMonth;
        const editId = this.editingExpenseId;

        try {
            const res = await api.updateExpense(editMonth, editId, amount, description);
            ui.closeModal('edit-expense-modal');
            this.editingExpenseId = null;
            ui.showToast('Expense updated!', 'success');

            // Apply the mutation response in place rather than refetching
            // (review C4/H1): the response carries the updated expense and the
            // new total_balance. The cache for this month is then dropped so a
            // later revisit refetches authoritative summary fields.
            this.applyExpenseUpdate(editMonth, res);
            this.invalidateMonth(editMonth);
        } catch (error) {
            ui.showError('edit-expense-error', error.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = origText;
        }
    }

    /**
     * Updates the in-memory month state from an updateExpense response and
     * re-renders, without a refetch. No-ops if the user navigated away.
     * @param {string} month
     * @param {Object} res - UpdateExpenseResponse { expense, total_balance }
     */
    applyExpenseUpdate(month, res) {
        if (month !== this.currentMonth || !this.monthData) return;
        const updated = res.expense;
        if (updated) {
            const idx = this.allExpenses.findIndex((e) => e.id === updated.id);
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
            }
        }
        if (typeof res.total_balance === 'number') {
            this.monthData.total_balance = res.total_balance;
        }
        ui.updateDashboard(this.monthData);
        ui.renderExpenses(this.allExpenses, this.expenseCallbacks(), this.expensesCursor);
    }

    async handleDeleteExpense(expenseId) {
        const delMonth = this.currentMonth;
        try {
            await api.deleteExpense(delMonth, expenseId);
            ui.showToast('Expense deleted', 'success');

            // The delete response is minimal (success only), so reconstruct the
            // new totals locally from the removed row (review C4/H1), then drop
            // the cache so a revisit refetches authoritative summary fields.
            this.applyExpenseDelete(delMonth, expenseId);
            this.invalidateMonth(delMonth);
        } catch (error) {
            ui.showToast('Failed to delete expense', 'error');
        }
    }

    /**
     * Removes an expense from in-memory state and re-renders without a
     * refetch. No-ops if the user navigated away.
     * @param {string} month
     * @param {string} expenseId
     */
    applyExpenseDelete(month, expenseId) {
        if (month !== this.currentMonth || !this.monthData) return;
        const idx = this.allExpenses.findIndex((e) => e.id === expenseId);
        if (idx === -1) return;
        const removed = this.allExpenses[idx];
        const removedAmount = parseFloat(removed.amount) || 0;
        this.allExpenses.splice(idx, 1);
        if (this.monthData.summary) {
            this.monthData.summary.total_expenses = roundCents(
                (this.monthData.summary.total_expenses || 0) - removedAmount);
            // Deleting an expense refunds it to the month's ending balance too.
            if (this.monthData.summary.ending_balance !== undefined) {
                this.monthData.summary.ending_balance = roundCents(
                    (this.monthData.summary.ending_balance || 0) + removedAmount);
            }
        }
        // Deleting an expense refunds it to the overall balance.
        this.monthData.total_balance = roundCents((this.monthData.total_balance || 0) + removedAmount);
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
