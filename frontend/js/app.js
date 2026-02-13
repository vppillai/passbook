// Main Application Entry Point
import { api } from './api.js';
import { auth } from './auth.js';
import * as ui from './ui.js';

class App {
    constructor() {
        this.currentMonth = ui.getCurrentMonthKey();
        this.monthData = null;
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
                    await this.loadCurrentMonth();
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
        await this.loadCurrentMonth();
        await this.loadMonthsList();
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

        // Modal backdrop click
        document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
            backdrop.addEventListener('click', () => {
                const modal = backdrop.closest('.modal');
                ui.hideModal(modal.id);
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
        });

        // Session expired
        window.addEventListener('session-expired', () => {
            ui.showToast('Session expired. Please log in again.', 'error');
            ui.showScreen('auth-screen');
        });
    }

    async loadCurrentMonth() {
        try {
            this.monthData = await api.getMonth(this.currentMonth);
            ui.updateDashboard(this.monthData);
            ui.renderExpenses(this.monthData.expenses, (id) => this.handleDeleteExpense(id));
        } catch (error) {
            console.error('Failed to load month data:', error);
            throw error;
        }
    }

    async loadMonthsList() {
        try {
            const { months } = await api.getMonths();
            ui.renderMonthsList(months, this.currentMonth, (month) => this.selectMonth(month));
        } catch (error) {
            console.error('Failed to load months list:', error);
        }
    }

    async selectMonth(month) {
        this.currentMonth = month;
        ui.hideMenu();

        try {
            this.monthData = await api.getMonth(month);
            ui.updateDashboard(this.monthData);
            ui.renderExpenses(this.monthData.expenses, (id) => this.handleDeleteExpense(id));
        } catch (error) {
            ui.showToast('Failed to load month data', 'error');
        }
    }

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

        if (!description) {
            ui.showError('expense-error', 'Please enter a description');
            return;
        }

        try {
            await api.addExpense(amount, description);
            ui.hideModal('expense-modal');
            document.getElementById('expense-form').reset();
            ui.showToast('Expense added!', 'success');

            // Reload current month
            await this.loadCurrentMonth();
        } catch (error) {
            ui.showError('expense-error', error.message);
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

    async handleChangePin() {
        const currentPin = document.getElementById('current-pin').value;
        const newPin = document.getElementById('new-pin').value;

        ui.hideError('change-pin-error');

        if (!/^\d{4,6}$/.test(newPin)) {
            ui.showError('change-pin-error', 'New PIN must be 4-6 digits');
            return;
        }

        try {
            await api.changePin(currentPin, newPin);
            ui.hideModal('change-pin-modal');
            document.getElementById('change-pin-form').reset();
            ui.showToast('PIN changed successfully!', 'success');
        } catch (error) {
            ui.showError('change-pin-error', error.message);
        }
    }
}

// Initialize app when DOM is ready
const app = new App();
document.addEventListener('DOMContentLoaded', () => app.init());
