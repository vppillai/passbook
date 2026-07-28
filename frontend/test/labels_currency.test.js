import { test, expect, describe, beforeEach } from 'bun:test';

// Everything instance-specific is configurable — theme, wording, PWA identity,
// even the number formatting — except three amount labels that hardcoded "($)".
// A euro instance rendered "Amount ($)" directly above a "1.234,50 €" figure.
//
// The FAB had the mirror-image problem: its accessible name was wired to
// expense_buy_label, which is the DESCRIPTION FIELD's label. Screen readers
// announced "What did you buy?, button" — a question where a command belongs, and
// on the eatout instance "Where did you eat?, button" for a button that adds an
// expense.
//
// labels.js resolves window.PASSBOOK_FORMAT at call time, but a cache-busted
// import per case keeps the module state independent.
describe('currency-aware amount labels', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <button id="fab" aria-label="Add expense" data-i18n-aria-label="add_expense_action"></button>
            <label for="a" data-amount-label>Amount ($)</label>
            <label for="b" data-amount-label>Amount ($)</label>`;
    });

    test('uses the configured currency symbol', async () => {
        window.PASSBOOK_FORMAT = { locale: 'de-DE', currency: 'EUR' };
        const labels = await import('../js/labels.js?cur=eur');
        expect(labels.currencySymbol()).toBe('€');
        labels.applyLabels();
        for (const el of document.querySelectorAll('[data-amount-label]')) {
            expect(el.textContent).toBe('Amount (€)');
            expect(el.textContent).not.toContain('$');
        }
    });

    test('defaults to the dollar sign when nothing is configured', async () => {
        window.PASSBOOK_FORMAT = undefined;
        const labels = await import('../js/labels.js?cur=default');
        expect(labels.currencySymbol()).toBe('$');
        labels.applyLabels();
        expect(document.querySelector('[data-amount-label]').textContent).toBe('Amount ($)');
    });

    test('a currency with no symbol falls back to its code rather than blank', async () => {
        window.PASSBOOK_FORMAT = { locale: 'en-US', currency: 'XPT' };
        const labels = await import('../js/labels.js?cur=xpt');
        const symbol = labels.currencySymbol();
        expect(symbol.length).toBeGreaterThan(0);
        labels.applyLabels();
        expect(document.querySelector('[data-amount-label]').textContent).toContain(symbol);
    });

    test('an unusable currency config does not throw or blank the label', async () => {
        window.PASSBOOK_FORMAT = { locale: 'not-a-locale!!', currency: 'NOPE' };
        const labels = await import('../js/labels.js?cur=broken');
        expect(typeof labels.currencySymbol()).toBe('string');
        labels.applyLabels();
        expect(document.querySelector('[data-amount-label]').textContent.length)
            .toBeGreaterThan(0);
    });

    test("the add button's accessible name is an action, not a question", async () => {
        window.PASSBOOK_FORMAT = undefined;
        const labels = await import('../js/labels.js?cur=fab');
        labels.applyLabels();
        const name = document.getElementById('fab').getAttribute('aria-label');
        expect(name).toBe('Add expense');
        expect(name).not.toContain('?');
        // And the key it resolves must exist, or applyLabels silently leaves the
        // static English in place on every instance that overrides labels.
        expect(labels.labels.add_expense_action).toBeTruthy();
    });

    test('the amount label carries a placeholder for the symbol', async () => {
        // The symbol is substituted into amount_label, so an instance that
        // overrides the wording can still place it. A default without the
        // placeholder would reintroduce the hardcoding it replaced.
        const labels = await import('../js/labels.js?cur=placeholder');
        expect(labels.labels.amount_label).toContain('{currency}');
    });
});
