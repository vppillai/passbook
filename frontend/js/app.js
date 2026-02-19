// Main Application Entry Point
import { api } from './api.js';
import { auth } from './auth.js';
import * as ui from './ui.js';

class App {
    constructor() {
        this.currentMonth = null;
        this.monthData = null;
        this.allExpenses = [];
        this.expensesCursor = null;
        this.editingExpenseId = null;
    }

    async init() {
        try {
            // Check if PIN is set up
            const isSetup = await api.checkSetup();

            if (!isSetup) {
                ui.showScreen('setup-screen');
                auth.init(() => this.onAuthSuccess());
            } else if (api.hasSession()) {
                // Try to use existing session
                try {
                    await this.loadInitialData();
                    ui.showScreen('main-screen');
                    auth.init(() => this.onAuthSuccess());
                } catch (e) {
                    // Session invalid, show auth
                    ui.showScreen('auth-screen');
                    auth.init(() => this.onAuthSuccess());
                }
            } else {
                ui.showScreen('auth-screen');
                auth.init(() => this.onAuthSuccess());
            }

            this.bindEvents();
        } catch (error) {
            console.error('Failed to initialize:', error);
            ui.showToast('Failed to connect to server', 'error');
            // Show auth screen anyway
            ui.showScreen('auth-screen');
            auth.init(() => this.onAuthSuccess());
        }
    }

    async onAuthSuccess() {
        ui.showScreen('main-screen');
        await this.loadInitialData();
    }

    async loadInitialData() {
        // First, get the list of months to find the latest one
        const data = await api.getMonths();
        const months = data.months;

        if (months && months.length > 0) {
            // Use the latest month (list is sorted descending)
            this.currentMonth = months[0].month;
            await this.loadCurrentMonth();
        } else {
            // No months exist - show empty state
            this.currentMonth = null;
            ui.showEmptyState();
        }

        ui.renderMonthsList(
            months,
            this.currentMonth,
            (month) => this.selectMonth(month),
            data.next_cursor,
            (cursor) => this.loadMoreMonths(cursor)
        );
    }

    bindEvents() {
        // Add expense button
        document.getElementById('add-expense-btn').addEventListener('click', () => {
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
            ui.hideModal('expense-modal');
            document.getElementById('expense-form').reset();
            ui.hideError('expense-error');
        });

        // Edit expense form
        document.getElementById('edit-expense-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleEditExpense();
        });

        // Cancel edit expense
        document.getElementById('cancel-edit-expense').addEventListener('click', () => {
            ui.hideModal('edit-expense-modal');
            document.getElementById('edit-expense-form').reset();
            ui.hideError('edit-expense-error');
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
            ui.hideModal('create-month-modal');
            document.getElementById('create-month-form').reset();
            ui.hideError('create-month-error');
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
            ui.hideModal('add-funds-modal');
            document.getElementById('add-funds-form').reset();
            ui.hideError('add-funds-error');
        });

        // Modal backdrop click
        document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
            backdrop.addEventListener('click', () => {
                const modal = backdrop.closest('.modal');
                ui.hideModal(modal.id);
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
            ui.hideModal('change-pin-modal');
            document.getElementById('change-pin-form').reset();
            ui.hideError('change-pin-error');
            // Reset all PIN visibility to hidden
            document.querySelectorAll('.btn-show-pin').forEach(btn => {
                const input = document.getElementById(btn.dataset.target);
                if (input) input.type = 'password';
                btn.querySelector('.icon-eye').classList.remove('hidden');
                btn.querySelector('.icon-eye-off').classList.add('hidden');
            });
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

        // Session expired
        window.addEventListener('session-expired', () => {
            ui.showToast('Session expired. Please log in again.', 'error');
            ui.showScreen('auth-screen');
        });
    }

    // --- Data loading ---

    async loadCurrentMonth() {
        try {
            this.monthData = await api.getMonth(this.currentMonth);
            this.allExpenses = this.monthData.expenses || [];
            this.expensesCursor = this.monthData.next_cursor || null;

            ui.updateDashboard(this.monthData);
            ui.renderExpenses(this.allExpenses, {
                onDelete: (id) => this.handleDeleteExpense(id),
                onEdit: (id, amount, desc) => this.openEditExpense(id, amount, desc),
                onLoadMore: (cursor) => this.loadMoreExpenses(cursor),
            }, this.expensesCursor);
        } catch (error) {
            console.error('Failed to load month data:', error);
            throw error;
        }
    }

    async loadMonthsList() {
        try {
            const data = await api.getMonths();
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

    async loadMoreExpenses(cursor) {
        try {
            const data = await api.getMonth(this.currentMonth, cursor);
            this.allExpenses = [...this.allExpenses, ...(data.expenses || [])];
            this.expensesCursor = data.next_cursor || null;

            ui.renderExpenses(this.allExpenses, {
                onDelete: (id) => this.handleDeleteExpense(id),
                onEdit: (id, amount, desc) => this.openEditExpense(id, amount, desc),
                onLoadMore: (cursor) => this.loadMoreExpenses(cursor),
            }, this.expensesCursor);
        } catch (error) {
            ui.showToast('Failed to load more expenses', 'error');
        }
    }

    async loadMoreMonths(cursor) {
        try {
            const data = await api.getMonths(cursor);
            // Append to existing months list
            const container = document.getElementById('months-list');
            const loadMoreItem = document.getElementById('load-more-months');
            if (loadMoreItem) loadMoreItem.remove();

            for (const month of data.months) {
                const li = document.createElement('li');
                li.className = `month-item ${month.month === this.currentMonth ? 'active' : ''}`;
                li.dataset.month = month.month;
                li.innerHTML = `
                    <span class="month-name">${ui.formatMonthName(month.month)}</span>
                    <span class="month-balance">${ui.formatCurrency(month.monthly_saved)}</span>
                `;
                li.addEventListener('click', () => this.selectMonth(month.month));
                container.appendChild(li);
            }

            if (data.next_cursor) {
                const newLoadMore = document.createElement('li');
                newLoadMore.id = 'load-more-months';
                newLoadMore.className = 'month-item load-more-item';
                newLoadMore.innerHTML = '<span>Load More...</span>';
                newLoadMore.addEventListener('click', () => this.loadMoreMonths(data.next_cursor));
                container.appendChild(newLoadMore);
            }
        } catch (error) {
            ui.showToast('Failed to load more months', 'error');
        }
    }

    async selectMonth(month) {
        this.currentMonth = month;
        ui.hideMenu();

        try {
            this.monthData = await api.getMonth(month);
            this.allExpenses = this.monthData.expenses || [];
            this.expensesCursor = this.monthData.next_cursor || null;

            ui.updateDashboard(this.monthData);
            ui.renderExpenses(this.allExpenses, {
                onDelete: (id) => this.handleDeleteExpense(id),
                onEdit: (id, amount, desc) => this.openEditExpense(id, amount, desc),
                onLoadMore: (cursor) => this.loadMoreExpenses(cursor),
            }, this.expensesCursor);
        } catch (error) {
            ui.showToast('Failed to load month data', 'error');
        }
    }

    // --- Expense handlers ---

    async handleAddExpense() {
        const amountInput = document.getElementById('expense-amount');
        const descInput = document.getElementById('expense-desc');
        const amount = parseFloat(amountInput.value);
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

        try {
            await api.addExpense(amount, description);
            ui.hideModal('expense-modal');
            document.getElementById('expense-form').reset();
            ui.showToast('Expense added!', 'success');

            // Reload data (in case a new month was created)
            await this.loadInitialData();
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
        const amount = parseFloat(amountInput.value);
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

        try {
            await api.updateExpense(this.currentMonth, this.editingExpenseId, amount, description);
            ui.hideModal('edit-expense-modal');
            document.getElementById('edit-expense-form').reset();
            this.editingExpenseId = null;
            ui.showToast('Expense updated!', 'success');
            await this.loadCurrentMonth();
        } catch (error) {
            ui.showError('edit-expense-error', error.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = origText;
        }
    }

    async handleDeleteExpense(expenseId) {
        try {
            await api.deleteExpense(this.currentMonth, expenseId);
            ui.showToast('Expense deleted', 'success');
            await this.loadCurrentMonth();
        } catch (error) {
            ui.showToast('Failed to delete expense', 'error');
        }
    }

    // --- Month management handlers ---

    async handleCreateMonth() {
        const monthInput = document.getElementById('new-month-input');
        const month = monthInput.value;

        ui.hideError('create-month-error');

        if (!month || month.length !== 7) {
            ui.showError('create-month-error', 'Please select a valid month');
            return;
        }

        const submitBtn = document.querySelector('#create-month-form button[type="submit"]');
        const origText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating...';

        try {
            await api.createMonth(month);
            ui.hideModal('create-month-modal');
            document.getElementById('create-month-form').reset();
            ui.showToast('Month created!', 'success');
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
        const amount = parseFloat(amountInput.value);

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

        try {
            await api.addFunds(this.currentMonth, amount);
            ui.hideModal('add-funds-modal');
            document.getElementById('add-funds-form').reset();
            ui.showToast('Funds added!', 'success');
            await this.loadCurrentMonth();
            this.loadMonthsList();
        } catch (error) {
            ui.showError('add-funds-error', error.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = origText;
        }
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
            ui.hideModal('change-pin-modal');
            document.getElementById('change-pin-form').reset();
            // Reset PIN visibility
            document.querySelectorAll('.btn-show-pin').forEach(btn => {
                const input = document.getElementById(btn.dataset.target);
                if (input) input.type = 'password';
                btn.querySelector('.icon-eye').classList.remove('hidden');
                btn.querySelector('.icon-eye-off').classList.add('hidden');
            });
            ui.showToast('PIN changed successfully!', 'success');
        } catch (error) {
            ui.showError('change-pin-error', error.message);
        } finally {
            // Reset button state
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    }
}

// Initialize app when DOM is ready
const app = new App();
document.addEventListener('DOMContentLoaded', () => app.init());
