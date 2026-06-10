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
