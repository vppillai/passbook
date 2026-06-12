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
import { roundCents } from './api.js';

/**
 * Fires a vibration pattern if the device supports it and the user has not
 * opted into reduced motion. Silently no-ops on unsupported platforms (desktop,
 * iOS Safari pre-16.4 without the Web Vibration API, etc.).
 * @param {number|number[]} pattern - milliseconds duration or [on,off,on,...] pattern
 */
export function vibrate(pattern) {
    if (!('vibrate' in navigator)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    try { navigator.vibrate(pattern); } catch { /* silently ignore unsupported */ }
}

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

/**
 * Formats an ISO-8601 timestamp from the API as a locale time string.
 * @param {string} dateStr - ISO-8601 timestamp (e.g. "2024-06-10T14:30:00Z")
 * @returns {string} Time in locale h:mm AM/PM format (e.g. "2:30 PM")
 */
export function formatTime(dateStr) {
    return new Date(dateStr).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
    });
}

/**
 * Returns true when two Date objects fall on the same calendar day in
 * local time. Used to decide whether a day-header separator is needed
 * between consecutive expense rows.
 * @param {Date} a
 * @param {Date} b
 * @returns {boolean}
 */
function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

/**
 * Derives a string key that uniquely identifies the local calendar day of
 * an ISO-8601 timestamp. `new Date(iso)` converts to local time, so the
 * key reflects the device's timezone — intentional, since users think of
 * expenses by local date. Note: the month component is 0-based (JS
 * getMonth()), so the key is not human-readable; it is only used for
 * adjacent-row grouping comparisons, never displayed.
 * @param {string} dateStr - ISO-8601 timestamp
 * @returns {string} Opaque day key (e.g. "2024-5-10" for June 10 2024)
 */
function dayKey(dateStr) {
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Returns a human-readable day label for an ISO-8601 timestamp, using
 * local time. Returns "Today" or "Yesterday" when the date matches the
 * current local day or the day before; otherwise falls back to a short
 * locale string (e.g. "Mon, Jun 10").
 * @param {string} dateStr - ISO-8601 timestamp
 * @returns {string} Display label for the day header
 */
function formatDayLabel(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    if (sameDay(d, now)) return 'Today';
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (sameDay(d, yesterday)) return 'Yesterday';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
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

// Remembers the element that had focus before each modal opened, keyed by
// modal id, so focus can return to the triggering control on close (a11y M3).
const modalReturnFocus = new Map();

export function showModal(modalId) {
    const modal = document.getElementById(modalId);
    // Capture the trigger so focus can be restored on close.
    const active = document.activeElement;
    if (active && active !== document.body) modalReturnFocus.set(modalId, active);
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    // Move focus into the modal: first focusable control, else the dialog.
    const focusable = modal.querySelector(
        'input, select, textarea, button, [tabindex]:not([tabindex="-1"])');
    if (focusable) {
        focusable.focus();
    } else {
        modal.setAttribute('tabindex', '-1');
        modal.focus();
    }
}

export function hideModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
    document.body.style.overflow = '';
    // Return focus to whatever opened the modal so keyboard users aren't
    // dumped back at the top of the document.
    const trigger = modalReturnFocus.get(modalId);
    if (trigger && document.contains(trigger)) {
        trigger.focus();
    }
    modalReturnFocus.delete(modalId);
}

/**
 * Closes a modal AND clears its transient state: resets the contained form
 * (if any) and hides its error banner. Centralizes the cleanup that Cancel
 * previously did so backdrop/Escape dismissals don't leave a stale error
 * banner or half-typed form on the next open (review F6).
 *
 * The error element follows the convention `<modal-id-without -modal>-error`,
 * but several modals deviate, so the error id is resolved by querying the
 * modal for its `.error` child.
 * @param {string} modalId
 */
export function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    hideModal(modalId);
    const form = modal.querySelector('form');
    if (form) form.reset();
    const error = modal.querySelector('.error');
    if (error) error.classList.add('hidden');
}

// hideMenu animates the slide-out over 300ms then hides it. showMenu must
// cancel any in-flight hide timer, otherwise a close→quick-reopen leaves the
// stale timeout running and it hides the freshly-opened menu (review F4).
let menuHideTimeout;
export function showMenu() {
    clearTimeout(menuHideTimeout);
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
    clearTimeout(menuHideTimeout);
    menuHideTimeout = setTimeout(() => {
        menu.classList.add('hidden');
        document.getElementById('menu-overlay').classList.add('hidden');
    }, 300);
}

let toastTimeout;
export function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    // A plain toast may follow an undo toast; clear any action button so the
    // previous Undo affordance doesn't linger.
    toast.replaceChildren();
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.remove('hidden');

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

// Tracks the dismiss handler of the currently-shown undo toast so a new toast
// (or an explicit dismiss) can settle the pending action exactly once.
let undoToastDismiss = null;

/**
 * Shows an action toast with a tappable Undo button for `durationMs`. The
 * toast reuses the existing #toast element but renders structured children
 * (message + 44px Undo button) instead of plain text.
 *
 * Exactly one of the callbacks fires:
 *   - onUndo()   when the user taps Undo before the timer expires.
 *   - onExpire() when the timer elapses, or when another toast/dismiss
 *                supersedes this one (i.e. "commit the deferred action now").
 *
 * @param {Object} opts
 * @param {string} opts.message - leading text (instance-divergent → labels)
 * @param {string} opts.actionText - Undo button label (→ labels)
 * @param {Function} opts.onUndo
 * @param {Function} opts.onExpire
 * @param {number} [opts.durationMs=5000]
 */
export function showUndoToast({ message, actionText, onUndo, onExpire, durationMs = 5000 }) {
    // Settle any previously-shown undo toast first (commit its deferred action)
    // so two rapid deletes don't leave the first one dangling.
    if (undoToastDismiss) undoToastDismiss('expire');

    const toast = document.getElementById('toast');
    clearTimeout(toastTimeout);
    toast.replaceChildren();
    toast.className = 'toast toast-action';

    const msg = document.createElement('span');
    msg.className = 'toast-message';
    msg.textContent = message;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-undo';
    btn.textContent = actionText;

    toast.appendChild(msg);
    toast.appendChild(btn);
    toast.classList.remove('hidden');

    let settled = false;
    let timer = null;
    // reason: 'undo' fires onUndo; anything else commits via onExpire.
    function settle(reason) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (undoToastDismiss === settle) undoToastDismiss = null;
        toast.classList.add('hidden');
        toast.replaceChildren();
        toast.className = 'toast';
        if (reason === 'undo') {
            if (typeof onUndo === 'function') onUndo();
        } else if (typeof onExpire === 'function') {
            onExpire();
        }
    }

    btn.addEventListener('click', () => settle('undo'));
    timer = setTimeout(() => settle('expire'), durationMs);
    undoToastDismiss = settle;

    // Subtle haptic when the toast appears (10ms, same as a key tap).
    vibrate(10);
}

/**
 * Immediately settles any visible undo toast as if its timer expired, i.e.
 * commits the deferred action now. No-op when no undo toast is showing.
 * Used before navigations (month switch) and page-hide so a pending delete
 * isn't left in limbo.
 */
export function flushUndoToast() {
    if (undoToastDismiss) undoToastDismiss('expire');
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
    // The dots are decorative; the aria-live region announces the running
    // count so screen-reader users get feedback as they type the PIN (a11y).
    container.setAttribute('aria-label', `${length} ${length === 1 ? 'digit' : 'digits'} entered`);
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
    //
    // Rows arrive newest-first; consecutive same-day rows are grouped
    // under a day header (Today / Yesterday / "Mon, Jun 5").
    let lastDay = null;
    for (const expense of expenses) {
        const day = dayKey(expense.created_at);
        if (day !== lastDay) {
            const header = document.createElement('div');
            header.className = 'day-header';
            header.textContent = formatDayLabel(expense.created_at);
            container.appendChild(header);
            lastDay = day;
        }
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
    date.textContent = formatTime(expense.created_at);
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
    delBtn.addEventListener('click', () => {
        // Optimistic delete with an Undo toast (replaces the confirm modal):
        // the row vanishes immediately and the DELETE is DEFERRED until the
        // toast expires (handled in app.js). The in-flight guard still blocks
        // a double-tap from queuing two pending deletes for the same row.
        if (deleting) return;
        deleting = true;
        callbacks.onDelete(expense.id);
        // The row is removed by the re-render that onDelete triggers, so this
        // closure is discarded; resetting the guard is belt-and-suspenders in
        // case the delete no-ops (e.g. user already navigated away).
        deleting = false;
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

        // showConfirm owns the confirm-modal's Escape handling itself, so the
        // promise ALWAYS resolves on dismissal (review F1). Without this, an
        // Escape that closed the modal via the global app.js handler left the
        // promise pending forever — the caller's in-flight `deleting` guard
        // stayed true and the delete button went dead. The global handler now
        // skips #confirm-modal precisely because this owns it.
        function onKeydown(e) {
            if (e.key === 'Escape') close(false);
        }

        function close(result) {
            document.removeEventListener('keydown', onKeydown, true);
            hideModal('confirm-modal');
            resolve(result);
        }
        newConfirm.addEventListener('click', () => close(true));
        newCancel.addEventListener('click', () => close(false));
        modal.querySelector('.modal-backdrop').addEventListener(
            'click', () => close(false), { once: true });
        // Capture phase so this fires before (and instead of) the global
        // Escape handler, which is bubble-phase and skips #confirm-modal.
        document.addEventListener('keydown', onKeydown, true);

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

    const maxExpenses = maxMonthExpenses(months);
    for (const month of months) {
        container.appendChild(buildMonthRow(month, currentMonth, onSelect, maxExpenses));
    }

    if (nextCursor && onLoadMore) {
        container.appendChild(buildLoadMoreMonthsItem(() => onLoadMore(nextCursor)));
    }
}

/**
 * Returns the largest total_expenses across the listed months, used to scale
 * the per-row spend bars. Months whose total_expenses is absent (the list API
 * may only carry monthly_saved) contribute 0, so the bars hide gracefully when
 * no spend data is available. Returns 0 when nothing is spendable.
 * @param {Array<Object>} months
 * @returns {number}
 */
export function maxMonthExpenses(months) {
    let max = 0;
    for (const m of (months || [])) {
        const v = Number(m.total_expenses) || 0;
        if (v > max) max = v;
    }
    return max;
}

export function buildMonthRow(month, currentMonth, onSelect, maxExpenses = 0) {
    // The selectable row is a real <button> (inside a list <li>) so it is
    // keyboard- and screen-reader-accessible — Enter/Space activate it and
    // it's announced as a button, unlike the previous click-only <li> (a11y).
    const li = document.createElement('li');
    li.className = 'month-row';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'month-item' + (month.month === currentMonth ? ' active' : '');
    btn.setAttribute('data-month', month.month);
    if (month.month === currentMonth) btn.setAttribute('aria-current', 'true');

    const main = document.createElement('span');
    main.className = 'month-item-main';

    const nameEl = document.createElement('span');
    nameEl.className = 'month-name';
    nameEl.textContent = formatMonthName(month.month);

    const saved = parseFloat(month.monthly_saved);
    const balanceEl = document.createElement('span');
    balanceEl.className = 'month-balance' + (saved < 0 ? ' balance-negative' : '');
    balanceEl.textContent = `${saved > 0 ? '+' : ''}${formatCurrency(month.monthly_saved)}`;

    main.appendChild(nameEl);
    main.appendChild(balanceEl);
    btn.appendChild(main);

    // Thin spend bar: width % of this month's total_expenses relative to the
    // max across the listed months. Set via the CSSOM `--w` custom property
    // (element.style.setProperty is permitted under CSP style-src — only
    // inline style ATTRIBUTES and <style> blocks are blocked), never an inline
    // style attribute. Rendered only when spend data is available (maxExpenses
    // > 0), so months-list payloads that omit total_expenses simply show no
    // bar instead of an empty track.
    const spend = Number(month.total_expenses) || 0;
    if (maxExpenses > 0) {
        const pct = Math.max(0, Math.min(100, Math.round((spend / maxExpenses) * 100)));
        const track = document.createElement('span');
        track.className = 'month-spend-bar';
        const fill = document.createElement('span');
        fill.className = 'month-spend-fill';
        fill.style.setProperty('--w', `${pct}%`);
        track.appendChild(fill);
        btn.appendChild(track);
    }

    if (typeof onSelect === 'function') {
        btn.addEventListener('click', () => onSelect(month.month));
    }
    li.appendChild(btn);
    return li;
}

/**
 * Builds the "Load More" list item as a real <button> for keyboard/SR access.
 * @param {Function} onClick - invoked when activated
 * @returns {HTMLLIElement}
 */
function buildLoadMoreMonthsItem(onClick) {
    const li = document.createElement('li');
    li.className = 'month-row';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'load-more-months';
    btn.className = 'month-item load-more-item';
    btn.textContent = 'Load More';
    btn.addEventListener('click', onClick);
    li.appendChild(btn);
    return li;
}

export { buildLoadMoreMonthsItem };

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
    clearDashboardLoading();
    // Update month title
    document.getElementById('month-title').textContent = formatMonthName(data.month);

    // Update balances - show this month's savings (allowance - expenses).
    // Round to cents BEFORE the sign checks: float dust (e.g. allowance
    // 100.00 - expenses 100.0000001 = -1e-7) would otherwise paint a green
    // $0.00 red, or flip a "+"/"-" prefix on a true zero (review F5).
    const monthlySaved = data.summary
        ? roundCents((data.summary.allowance_added || 0) - (data.summary.total_expenses || 0))
        : 0;
    const monthBalanceEl = document.getElementById('month-balance');
    monthBalanceEl.textContent = `${monthlySaved > 0 ? '+' : ''}${formatCurrency(monthlySaved)}`;
    monthBalanceEl.classList.toggle('balance-negative', monthlySaved < 0);

    const totalBalance = roundCents(data.total_balance || 0);
    const totalBalanceEl = document.getElementById('total-balance');
    totalBalanceEl.textContent = formatCurrency(totalBalance);
    totalBalanceEl.classList.toggle('balance-negative', totalBalance < 0);

    // Balance carried in from the previous month, positive or negative.
    // Without this chip a carried deficit is invisible: "This Month" can
    // read green while the real position (the hero) is negative, and
    // nothing explains the gap between the two numbers.
    const carryChip = document.getElementById('carryover-chip');
    const carried = data.summary ? roundCents(data.summary.starting_balance || 0) : 0;
    if (Math.abs(carried) >= 0.005) {
        carryChip.querySelector('.chip-label').textContent =
            `${labels.carried_from} ${formatPrevMonthName(data.month)}`;
        const valueEl = carryChip.querySelector('.chip-value');
        valueEl.textContent = `${carried > 0 ? '+' : ''}${formatCurrency(carried)}`;
        valueEl.classList.toggle('balance-negative', carried < 0);
        carryChip.classList.remove('hidden');
    } else {
        carryChip.classList.add('hidden');
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
    document.getElementById('carryover-chip').classList.add('hidden');
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

/**
 * Puts the dashboard into a loading/skeleton state shown after auth while the
 * first data load is in flight (review F3). Replaces the believable "$0.00"
 * dashboard — which previously rendered before any data arrived and was
 * indistinguishable from a real empty account — with placeholder text and a
 * `.loading` class hook the CSS can shimmer.
 */
export function showDashboardLoading() {
    document.getElementById('month-title').textContent = ' ';
    document.getElementById('carryover-chip').classList.add('hidden');
    const monthBalanceEl = document.getElementById('month-balance');
    monthBalanceEl.textContent = ' ';
    monthBalanceEl.classList.remove('balance-negative');
    monthBalanceEl.classList.add('loading-placeholder');
    const totalBalanceEl = document.getElementById('total-balance');
    totalBalanceEl.textContent = ' ';
    totalBalanceEl.classList.remove('balance-negative');
    totalBalanceEl.classList.add('loading-placeholder');
    document.getElementById('expenses-total').textContent = ' ';
    const list = document.getElementById('expenses-list');
    list.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'no-expenses';
    loading.textContent = 'Loading…';
    list.appendChild(loading);
}

// Clears the loading-placeholder hooks once real data (or an error) lands.
function clearDashboardLoading() {
    document.getElementById('total-balance').classList.remove('loading-placeholder');
    document.getElementById('month-balance').classList.remove('loading-placeholder');
}

/**
 * Renders a visible error in the expense area with a Retry button, used when
 * the initial dashboard load fails (review F3). Without this, a failed load
 * left a believable $0.00 dashboard with no indication anything went wrong.
 * @param {Function} onRetry - invoked when the Retry button is activated
 */
export function showDashboardError(onRetry) {
    clearDashboardLoading();
    document.getElementById('month-title').textContent = 'Couldn’t load';
    document.getElementById('total-balance').textContent = '—';
    document.getElementById('month-balance').textContent = '—';
    document.getElementById('expenses-total').textContent = '';
    document.getElementById('carryover-chip').classList.add('hidden');
    const list = document.getElementById('expenses-list');
    list.replaceChildren();
    const wrap = document.createElement('div');
    wrap.className = 'dashboard-error';
    const msg = document.createElement('p');
    msg.className = 'no-expenses';
    msg.textContent = 'Couldn’t load your data. Check your connection.';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-secondary btn-full';
    retry.textContent = 'Retry';
    if (typeof onRetry === 'function') retry.addEventListener('click', onRetry);
    wrap.appendChild(msg);
    wrap.appendChild(retry);
    list.appendChild(wrap);
}

/**
 * Shows or hides the add-expense modal hint. The hint now derives the target
 * month from the chosen date input (if provided) rather than always defaulting
 * to the current calendar month. Shows only when the derived target month
 * differs from the currently-viewed month.
 *
 * @param {string|null} viewedMonth - "YYYY-MM" key of the month currently on
 *   screen (the one the user is viewing), or null to clear the hint.
 * @param {boolean} show - whether to show the hint (legacy fallback path)
 * @param {string|null} [chosenDate] - "YYYY-MM-DD" value from the date input,
 *   or null/undefined to fall back to the current calendar month.
 */
export function setExpenseMonthHint(viewedMonth, show, chosenDate) {
    const hint = document.getElementById('expense-month-hint');
    if (!hint) return;

    // Derive the target month from the chosen date when provided; otherwise
    // fall back to the live current-calendar month (original behaviour).
    let targetMonth;
    if (chosenDate) {
        // "YYYY-MM-DD" → "YYYY-MM"
        const m = String(chosenDate).match(/^(\d{4}-\d{2})/);
        targetMonth = m ? m[1] : getCurrentMonthKey();
    } else {
        targetMonth = getCurrentMonthKey();
    }

    // Show the hint only when the expense would land in a different month than
    // the one the user is currently viewing.
    const shouldShow = !!(viewedMonth && targetMonth !== viewedMonth);
    if (shouldShow) {
        hint.textContent = labels.expense_added_to_hint.replace(
            '{month}', formatMonthName(targetMonth));
        hint.classList.remove('hidden');
    } else {
        hint.textContent = '';
        hint.classList.add('hidden');
    }
}

// Re-exported so updateDashboard callers can clear the loading hooks; called
// from updateDashboard itself below as well.
export { clearDashboardLoading };
