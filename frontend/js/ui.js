/**
 * UI Helper Functions
 *
 * Pure presentation layer utilities for the Passbook application. Contains
 * formatting helpers, screen/modal management, toast notifications, and
 * DOM rendering functions for expenses and months lists.
 *
 * @module ui
 */

/** Full month names indexed 0-11 for converting "YYYY-MM" keys to display strings */
const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Formats a numeric amount as a US dollar currency string (e.g. "$1,234.56").
 * @param {number} amount - The monetary amount to format
 * @returns {string} Locale-formatted USD currency string
 */
export function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(amount);
}

export function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

export function formatMonthName(monthKey) {
    const [year, month] = monthKey.split('-');
    return `${MONTHS[parseInt(month, 10) - 1]} ${year}`;
}

export function getCurrentMonthKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

export function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.add('hidden');
    });
    document.getElementById(screenId).classList.remove('hidden');
}

export function showModal(modalId) {
    document.getElementById(modalId).classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

export function hideModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
    document.body.style.overflow = '';
}

export function showMenu() {
    document.getElementById('menu-overlay').classList.remove('hidden');
    const menu = document.getElementById('history-menu');
    menu.classList.remove('hidden');
    // Trigger reflow for animation
    menu.offsetHeight;
    menu.classList.add('visible');
}

export function hideMenu() {
    const menu = document.getElementById('history-menu');
    menu.classList.remove('visible');
    setTimeout(() => {
        menu.classList.add('hidden');
        document.getElementById('menu-overlay').classList.add('hidden');
    }, 300);
}

let toastTimeout;
export function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.remove('hidden');

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

export function showError(elementId, message) {
    const el = document.getElementById(elementId);
    el.textContent = message;
    el.classList.remove('hidden');
}

export function hideError(elementId) {
    document.getElementById(elementId).classList.add('hidden');
}

export function updatePinDisplay(containerId, length) {
    const container = document.querySelector(`#${containerId} .pin-display`) ||
                      document.querySelector(`#${containerId}`);
    if (!container) return;

    const dots = container.querySelectorAll('.pin-dot');
    dots.forEach((dot, i) => {
        dot.classList.toggle('filled', i < length);
        dot.classList.remove('error');
    });
}

export function showPinError(containerId) {
    const container = document.querySelector(`#${containerId} .pin-display`) ||
                      document.querySelector(`#${containerId}`);
    if (!container) return;

    const dots = container.querySelectorAll('.pin-dot');
    dots.forEach(dot => {
        dot.classList.add('error');
    });

    setTimeout(() => {
        dots.forEach(dot => {
            dot.classList.remove('error', 'filled');
        });
    }, 300);
}

export function renderExpenses(expenses, callbacks, nextCursor = null) {
    const container = document.getElementById('expenses-list');

    if (!expenses || expenses.length === 0) {
        container.innerHTML = '<p class="no-expenses">No expenses yet this month</p>';
        return;
    }

    container.innerHTML = expenses.map(expense => `
        <div class="expense-item" data-id="${encodeURIComponent(expense.id)}" data-amount="${expense.amount}" data-desc="${escapeHtml(expense.description)}">
            <div class="expense-info">
                <div class="expense-desc">${escapeHtml(expense.description)}</div>
                <div class="expense-date">${formatDate(expense.created_at)}</div>
            </div>
            <div class="expense-amount">-${formatCurrency(expense.amount)}</div>
            <button class="expense-edit" aria-label="Edit expense">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>
            <button class="expense-delete" aria-label="Delete expense">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3,6 5,6 21,6"></polyline>
                    <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6M8,6V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2V6"></path>
                </svg>
            </button>
        </div>
    `).join('');

    // Add "Load More" button if there's a next cursor
    if (nextCursor && callbacks.onLoadMore) {
        const loadMoreBtn = document.createElement('button');
        loadMoreBtn.id = 'load-more-expenses';
        loadMoreBtn.className = 'btn btn-secondary btn-full load-more-btn';
        loadMoreBtn.textContent = 'Load More';
        loadMoreBtn.addEventListener('click', () => {
            callbacks.onLoadMore(nextCursor);
        });
        container.appendChild(loadMoreBtn);
    }

    // Add edit handlers
    container.querySelectorAll('.expense-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const item = e.target.closest('.expense-item');
            const id = decodeURIComponent(item.dataset.id);
            const amount = parseFloat(item.dataset.amount);
            const desc = item.dataset.desc;
            callbacks.onEdit(id, amount, desc);
        });
    });

    // Add delete handlers
    container.querySelectorAll('.expense-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const item = e.target.closest('.expense-item');
            const id = decodeURIComponent(item.dataset.id);
            if (confirm('Delete this expense?')) {
                callbacks.onDelete(id);
            }
        });
    });
}

export function renderMonthsList(months, currentMonth, onSelect, nextCursor = null, onLoadMore = null) {
    const container = document.getElementById('months-list');

    if (!months || months.length === 0) {
        container.innerHTML = '<li class="month-item"><span>No history yet</span></li>';
        return;
    }

    container.innerHTML = months.map(month => `
        <li class="month-item ${month.month === currentMonth ? 'active' : ''}" data-month="${month.month}">
            <span class="month-name">${formatMonthName(month.month)}</span>
            <span class="month-balance">${formatCurrency(month.monthly_saved)}</span>
        </li>
    `).join('');

    if (nextCursor && onLoadMore) {
        const loadMoreItem = document.createElement('li');
        loadMoreItem.id = 'load-more-months';
        loadMoreItem.className = 'month-item load-more-item';
        loadMoreItem.innerHTML = '<span>Load More...</span>';
        loadMoreItem.addEventListener('click', () => {
            onLoadMore(nextCursor);
        });
        container.appendChild(loadMoreItem);
    }

    container.querySelectorAll('.month-item:not(.load-more-item)').forEach(item => {
        item.addEventListener('click', () => {
            onSelect(item.dataset.month);
        });
    });
}

export function populateEditExpenseModal(amount, description) {
    document.getElementById('edit-expense-amount').value = amount;
    document.getElementById('edit-expense-desc').value = description;
    showModal('edit-expense-modal');
    document.getElementById('edit-expense-amount').focus();
}

export function updateDashboard(data) {
    // Update month title
    document.getElementById('month-title').textContent = formatMonthName(data.month);

    // Update balances - show this month's savings (allowance - expenses)
    const monthlySaved = data.summary
        ? (data.summary.allowance_added || 0) - (data.summary.total_expenses || 0)
        : 0;
    document.getElementById('month-balance').textContent = formatCurrency(monthlySaved);
    document.getElementById('total-balance').textContent = formatCurrency(data.total_balance);

    // Update expenses total
    const totalExpenses = data.summary ? data.summary.total_expenses : 0;
    document.getElementById('expenses-total').textContent = `${formatCurrency(totalExpenses)} spent`;
}

export function showEmptyState() {
    // Show empty state when no months exist
    document.getElementById('month-title').textContent = 'No Data Yet';
    document.getElementById('month-balance').textContent = formatCurrency(0);
    document.getElementById('total-balance').textContent = formatCurrency(0);
    document.getElementById('expenses-total').textContent = '$0.00 spent';
    document.getElementById('expenses-list').innerHTML =
        '<p class="no-expenses">No entries yet. Open the menu to create a new month.</p>';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
