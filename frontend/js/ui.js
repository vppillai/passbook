/**
 * UI Helper Functions
 *
 * Pure presentation layer utilities for the Passbook application. Contains
 * formatting helpers, screen/modal management, toast notifications, and
 * DOM rendering functions for expenses and months lists.
 *
 * @module ui
 */

import { labels } from './labels.js';

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
    container.replaceChildren();

    if (!expenses || expenses.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'no-expenses';
        empty.textContent = 'No expenses yet this month';
        container.appendChild(empty);
        return;
    }

    // Build each expense row via createElement/setAttribute (NOT innerHTML
    // with templated values). Server data sits in data-* attributes through
    // setAttribute, so even an adversarial backend that started returning
    // weird expense IDs cannot break out of the attribute context.
    for (const expense of expenses) {
        container.appendChild(buildExpenseRow(expense, callbacks));
    }

    if (nextCursor && callbacks.onLoadMore) {
        const loadMoreBtn = document.createElement('button');
        loadMoreBtn.id = 'load-more-expenses';
        loadMoreBtn.className = 'btn btn-secondary btn-full load-more-btn';
        loadMoreBtn.textContent = 'Load More';
        loadMoreBtn.addEventListener('click', () => callbacks.onLoadMore(nextCursor));
        container.appendChild(loadMoreBtn);
    }
}

// SVG markup is static and not user-controlled, so building it once via
// innerHTML inside a fresh element is safe and avoids verbose
// createElementNS chains.
function svgIcon(paths) {
    const wrapper = document.createElement('span');
    wrapper.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${paths}</svg>`;
    return wrapper.firstChild;
}

function buildExpenseRow(expense, callbacks) {
    const row = document.createElement('div');
    row.className = 'expense-item';
    row.setAttribute('data-id', expense.id);          // safe — attribute API, no HTML parsing
    row.setAttribute('data-amount', String(expense.amount));
    row.setAttribute('data-desc', expense.description); // safe — attribute API

    const info = document.createElement('div');
    info.className = 'expense-info';
    const desc = document.createElement('div');
    desc.className = 'expense-desc';
    desc.textContent = expense.description;
    const date = document.createElement('div');
    date.className = 'expense-date';
    date.textContent = formatDate(expense.created_at);
    info.appendChild(desc);
    info.appendChild(date);

    const amt = document.createElement('div');
    amt.className = 'expense-amount';
    amt.textContent = `-${formatCurrency(expense.amount)}`;

    const editBtn = document.createElement('button');
    editBtn.className = 'expense-edit';
    editBtn.setAttribute('aria-label', 'Edit expense');
    editBtn.appendChild(svgIcon(
        '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>' +
        '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>'
    ));
    editBtn.addEventListener('click', () => {
        callbacks.onEdit(expense.id, parseFloat(expense.amount), expense.description);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'expense-delete';
    delBtn.setAttribute('aria-label', 'Delete expense');
    delBtn.appendChild(svgIcon(
        '<polyline points="3,6 5,6 21,6"></polyline>' +
        '<path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6M8,6V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2V6"></path>'
    ));
    let deleting = false;
    delBtn.addEventListener('click', async () => {
        // In-flight guard. Without this, a double-tap fires the confirm
        // modal twice and emits two DELETE calls; the second 404's after
        // the first succeeds, surfacing as a confusing toast.
        if (deleting) return;
        deleting = true;
        try {
            const ok = await showConfirm({
                title: 'Delete this expense?',
                body: `${expense.description} — ${formatCurrency(expense.amount)} will be refunded to your balance.`,
                confirmText: 'Delete',
                danger: true,
            });
            if (ok) callbacks.onDelete(expense.id);
        } finally {
            deleting = false;
        }
    });

    row.appendChild(info);
    row.appendChild(amt);
    row.appendChild(editBtn);
    row.appendChild(delBtn);
    return row;
}

// showConfirm replaces the native confirm() dialog with the app's modal
// system. Returns a Promise<boolean> that resolves to true on confirm,
// false on cancel/Escape/backdrop. Used for any destructive action where
// the native dialog's styling clashes with the PWA look (jarring on iOS
// standalone). No undo is wired up here — the user got a styled,
// localized prompt instead of the OS chrome.
export function showConfirm({ title, body, confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        document.getElementById('confirm-modal-title').textContent = title || 'Are you sure?';
        document.getElementById('confirm-modal-body').textContent = body || '';
        const confirmBtn = document.getElementById('confirm-modal-confirm');
        const cancelBtn = document.getElementById('confirm-modal-cancel');
        confirmBtn.textContent = confirmText;
        cancelBtn.textContent = cancelText;
        confirmBtn.classList.toggle('btn-danger', !!danger);

        // Reset listeners each call by replacing the buttons with clones —
        // simple way to avoid stacking handlers across consecutive confirms.
        const newConfirm = confirmBtn.cloneNode(true);
        const newCancel = cancelBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
        cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

        function close(result) {
            hideModal('confirm-modal');
            resolve(result);
        }
        newConfirm.addEventListener('click', () => close(true));
        newCancel.addEventListener('click', () => close(false));
        modal.querySelector('.modal-backdrop').addEventListener(
            'click', () => close(false), { once: true });

        showModal('confirm-modal');
        newConfirm.focus();
    });
}

export function renderMonthsList(months, currentMonth, onSelect, nextCursor = null, onLoadMore = null) {
    const container = document.getElementById('months-list');
    container.replaceChildren();

    if (!months || months.length === 0) {
        const li = document.createElement('li');
        li.className = 'month-item';
        const span = document.createElement('span');
        span.textContent = 'No history yet';
        li.appendChild(span);
        container.appendChild(li);
        return;
    }

    for (const month of months) {
        container.appendChild(buildMonthRow(month, currentMonth, onSelect));
    }

    if (nextCursor && onLoadMore) {
        const loadMoreItem = document.createElement('li');
        loadMoreItem.id = 'load-more-months';
        loadMoreItem.className = 'month-item load-more-item';
        const span = document.createElement('span');
        span.textContent = 'Load More...';
        loadMoreItem.appendChild(span);
        loadMoreItem.addEventListener('click', () => onLoadMore(nextCursor));
        container.appendChild(loadMoreItem);
    }
}

export function buildMonthRow(month, currentMonth, onSelect) {
    const li = document.createElement('li');
    li.className = 'month-item' + (month.month === currentMonth ? ' active' : '');
    li.setAttribute('data-month', month.month);

    const nameEl = document.createElement('span');
    nameEl.className = 'month-name';
    nameEl.textContent = formatMonthName(month.month);

    const saved = parseFloat(month.monthly_saved);
    const balanceEl = document.createElement('span');
    balanceEl.className = 'month-balance' + (saved < 0 ? ' balance-negative' : '');
    balanceEl.textContent = formatCurrency(month.monthly_saved);

    li.appendChild(nameEl);
    li.appendChild(balanceEl);
    if (typeof onSelect === 'function') {
        li.addEventListener('click', () => onSelect(month.month));
    }
    return li;
}

export function populateEditExpenseModal(amount, description) {
    document.getElementById('edit-expense-amount').value = amount;
    document.getElementById('edit-expense-desc').value = description;
    showModal('edit-expense-modal');
    document.getElementById('edit-expense-amount').focus();
}

// formatPrevMonthName returns the display name of the month before the
// given "YYYY-MM" key (JS Date handles the year rollover for January).
function formatPrevMonthName(monthKey) {
    const [year, month] = monthKey.split('-').map(Number);
    const prev = new Date(year, month - 2, 1); // month-1 is this month (0-based), so month-2 is the previous one
    return `${MONTHS[prev.getMonth()]} ${prev.getFullYear()}`;
}

export function updateDashboard(data) {
    // Update month title
    document.getElementById('month-title').textContent = formatMonthName(data.month);

    // Update balances - show this month's savings (allowance - expenses)
    const monthlySaved = data.summary
        ? (data.summary.allowance_added || 0) - (data.summary.total_expenses || 0)
        : 0;
    const monthBalanceEl = document.getElementById('month-balance');
    monthBalanceEl.textContent = formatCurrency(monthlySaved);
    monthBalanceEl.classList.toggle('balance-negative', monthlySaved < 0);

    const totalBalanceEl = document.getElementById('total-balance');
    totalBalanceEl.textContent = formatCurrency(data.total_balance);
    totalBalanceEl.classList.toggle('balance-negative', data.total_balance < 0);

    // Balance carried in from the previous month, positive or negative.
    // Without this line a carried deficit is invisible: "This Month" can
    // read green while the real position (Total) is negative, and nothing
    // explains the gap between the two tiles.
    const carryEl = document.getElementById('carryover-line');
    const carried = data.summary ? (data.summary.starting_balance || 0) : 0;
    if (Math.abs(carried) >= 0.005) {
        const sign = carried > 0 ? '+' : '';
        carryEl.textContent = `${labels.carried_from} ${formatPrevMonthName(data.month)}: ${sign}${formatCurrency(carried)}`;
        carryEl.classList.toggle('carryover-negative', carried < 0);
        carryEl.classList.remove('hidden');
    } else {
        carryEl.classList.add('hidden');
    }

    // Update expenses total, with the month's budget for context
    const totalExpenses = data.summary ? data.summary.total_expenses : 0;
    const budget = data.summary ? (data.summary.allowance_added || 0) : 0;
    const ofBudget = budget > 0 ? ` of ${formatCurrency(budget)}` : '';
    document.getElementById('expenses-total').textContent =
        `${formatCurrency(totalExpenses)} ${labels.spent_suffix}${ofBudget}`;
}

export function showEmptyState() {
    // Show empty state when no months exist
    document.getElementById('month-title').textContent = 'No Data Yet';
    document.getElementById('carryover-line').classList.add('hidden');
    const emptyMonthBalanceEl = document.getElementById('month-balance');
    emptyMonthBalanceEl.textContent = formatCurrency(0);
    emptyMonthBalanceEl.classList.remove('balance-negative');
    const emptyTotalBalanceEl = document.getElementById('total-balance');
    emptyTotalBalanceEl.textContent = formatCurrency(0);
    emptyTotalBalanceEl.classList.remove('balance-negative');
    document.getElementById('expenses-total').textContent = `$0.00 ${labels.spent_suffix}`;
    const list = document.getElementById('expenses-list');
    list.replaceChildren();
    const empty = document.createElement('p');
    empty.className = 'no-expenses';
    empty.textContent = 'No entries yet. Open the menu to create a new month.';
    list.appendChild(empty);
}
