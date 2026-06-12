// Default English labels (kids passbook wording).
// Per-instance overrides come from `window.PASSBOOK_LABELS`, injected
// at build time by CI based on config/instances/<name>.yaml.

const defaultLabels = {
    app_title: 'My Passbook',
    app_description: 'Track allowance and expenses',
    total_savings: 'Total Savings',
    add_funds_button: '+ Funds',
    add_funds_modal_title: 'Add Funds',
    add_funds_modal_submit: 'Add Funds',
    expense_buy_label: 'What did you buy?',
    expense_buy_placeholder: 'e.g., Ice cream',
    monthly_allowance_hint: 'Monthly allowance will be applied automatically.',
    funds_added_toast: 'Funds added!',
    spent_suffix: 'spent',
    carried_from: 'Carried from',
    // Undo toast shown after an expense is (optimistically) deleted. The
    // action verb is instance-divergent (delete vs. remove), so it routes
    // through labels. The "UNDO" affordance text is a separate label.
    expense_deleted_undo: 'Expense deleted',
    undo_action: 'Undo',
    // Spending-pace chip (current month only). `{x}` is replaced at render
    // time with a formatted currency amount. Phrasing is instance-divergent.
    pace_label: 'Pace',
    pace_on_track: 'On track — {x}/day left',
    pace_overspend: 'Pace: overspend by ~{x}',
    pace_saved: 'Saved {x} so far',
    // Shown in the add-expense modal when the viewed month is not the current
    // one (review H5). `{month}` is replaced at render time with the current
    // month's display name. The phrasing is instance-divergent (e.g. an
    // expense vs. a meal), so it routes through labels.
    expense_added_to_hint: 'This will be added to {month}',

    // Shown in the update toast when a new service worker activates while the
    // user has the page open. Tapping the action reloads to pick up fresh assets.
    app_updated_toast: 'App updated — tap to refresh',
    // Action button label on the update toast.
    reload_action: 'Reload',
    // Shown when the user picks a future date in the add-expense modal.
    expense_date_future: 'Date cannot be in the future',

    // Auth error messages shown on the PIN screen.
    // `{n}` is replaced with the numeric attempts_remaining value.
    auth_wrong_pin: 'Incorrect PIN — {n} attempts remaining',
    // Shown when attempts_remaining is absent (i.e. already at the limit).
    auth_wrong_pin_no_remaining: 'Incorrect PIN',
    // Shown during a 429 lockout. `{time}` is replaced with "M:SS" countdown.
    auth_too_many_attempts: 'Too many attempts — try again in {time}',
};

const overrides = (typeof window !== 'undefined' && window.PASSBOOK_LABELS) || {};

export const labels = Object.freeze({ ...defaultLabels, ...overrides });

// Apply labels to all elements with data-i18n* attributes.
// Called once during app init, after DOM is parsed.
//
// Supported attributes:
//   data-i18n              → element.textContent
//   data-i18n-placeholder  → element.placeholder (for inputs)
//   data-i18n-aria-label   → element.setAttribute('aria-label', ...)
//   data-i18n-title        → element.title (tooltip)
//
// Previously only data-i18n and data-i18n-placeholder were honored, so
// hardcoded aria-label and title attributes on buttons (e.g. "Add expense")
// remained English for screen readers / tooltip viewers on every non-kids
// instance.
export function applyLabels() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (labels[key] !== undefined) el.textContent = labels[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.dataset.i18nPlaceholder;
        if (labels[key] !== undefined) el.placeholder = labels[key];
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
        const key = el.dataset.i18nAriaLabel;
        if (labels[key] !== undefined) el.setAttribute('aria-label', labels[key]);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.dataset.i18nTitle;
        if (labels[key] !== undefined) el.title = labels[key];
    });
    if (labels.app_title) document.title = labels.app_title;
}
