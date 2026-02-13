// UI Helper Functions

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

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

export function renderExpenses(expenses, onDelete) {
    const container = document.getElementById('expenses-list');

    if (!expenses || expenses.length === 0) {
        container.innerHTML = '<p class="no-expenses">No expenses yet this month</p>';
        return;
    }

    container.innerHTML = expenses.map(expense => `
        <div class="expense-item" data-id="${expense.id}">
            <div class="expense-info">
                <div class="expense-desc">${escapeHtml(expense.description)}</div>
                <div class="expense-date">${formatDate(expense.created_at)}</div>
            </div>
            <div class="expense-amount">-${formatCurrency(expense.amount)}</div>
            <button class="expense-delete" aria-label="Delete expense">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3,6 5,6 21,6"></polyline>
                    <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6M8,6V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2V6"></path>
                </svg>
            </button>
        </div>
    `).join('');

    // Add delete handlers
    container.querySelectorAll('.expense-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const item = e.target.closest('.expense-item');
            const id = item.dataset.id;
            if (confirm('Delete this expense?')) {
                onDelete(id);
            }
        });
    });
}

export function renderMonthsList(months, currentMonth, onSelect) {
    const container = document.getElementById('months-list');

    if (!months || months.length === 0) {
        container.innerHTML = '<li class="month-item"><span>No history yet</span></li>';
        return;
    }

    container.innerHTML = months.map(month => `
        <li class="month-item ${month.month === currentMonth ? 'active' : ''}" data-month="${month.month}">
            <span class="month-name">${formatMonthName(month.month)}</span>
            <span class="month-balance">${formatCurrency(month.ending_balance)}</span>
        </li>
    `).join('');

    container.querySelectorAll('.month-item').forEach(item => {
        item.addEventListener('click', () => {
            onSelect(item.dataset.month);
        });
    });
}

export function updateDashboard(data) {
    // Update month title
    document.getElementById('month-title').textContent = formatMonthName(data.month);

    // Update balances
    const monthBalance = data.summary ? data.summary.ending_balance : 0;
    document.getElementById('month-balance').textContent = formatCurrency(monthBalance);
    document.getElementById('total-balance').textContent = formatCurrency(data.total_balance);

    // Update expenses total
    const totalExpenses = data.summary ? data.summary.total_expenses : 0;
    document.getElementById('expenses-total').textContent = `${formatCurrency(totalExpenses)} spent`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
