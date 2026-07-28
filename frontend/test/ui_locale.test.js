import { test, expect, describe, beforeAll } from 'bun:test';

// ui.js resolves its locale ONCE at module-evaluation time from
// window.PASSBOOK_FORMAT, so the global has to be set before the import — hence
// a dedicated file with a dynamic import rather than a top-level one.
//
// This file exists because the tests in ui_months.test.js could not have failed
// against the old hardcoded-English implementation: with no PASSBOOK_FORMAT set,
// LOCALE falls back to 'en-US', and Intl's en-US month name is byte-identical to
// the English array that was removed ("February 2026"). They compared the new
// code against itself. Only a non-English locale distinguishes the two.
let ui;

beforeAll(async () => {
    window.PASSBOOK_FORMAT = { locale: 'de-DE', currency: 'EUR' };
    // Cache-bust so this import is evaluated fresh, after the global is set,
    // independently of any other file that already imported ui.js.
    ui = await import('../js/ui.js?locale=de-DE');
});

describe('non-default locale', () => {
    test('the module actually picked up the configured locale', () => {
        expect(ui.activeLocale()).toBe('de-DE');
    });

    test('month names are localized, not the old English table', () => {
        // The removed implementation would return "February 2026" here for any
        // locale, because it indexed a hardcoded English array.
        const got = ui.formatMonthName('2026-02');
        expect(got).not.toBe('February 2026');
        expect(got).toBe('Februar 2026');
    });

    test('every month renders in the configured locale', () => {
        expect(ui.formatMonthName('2026-01')).toBe('Januar 2026');
        expect(ui.formatMonthName('2026-03')).toBe('März 2026');
        expect(ui.formatMonthName('2026-12')).toBe('Dezember 2026');
    });

    test('amounts use the configured currency and locale', () => {
        const got = ui.formatCurrency(1234.5);
        expect(got).toContain('€');
        // de-DE uses comma as the decimal separator.
        expect(got).toContain('1.234,50');
        expect(got).not.toBe('$1,234.50');
    });

    test('the empty state formats its zero through the same formatter', () => {
        document.body.innerHTML = `
            <div id="month-title"></div>
            <div id="carryover-chip" class="hidden"><span class="chip-label"></span><span class="chip-value"></span></div>
            <div id="month-balance"></div>
            <div id="total-balance"></div>
            <div id="expenses-total"></div>
            <div id="expenses-list"></div>`;
        ui.showEmptyState();
        const spent = document.getElementById('expenses-total').textContent;
        // Previously a literal "$0.00" sat here beside euro-formatted figures.
        expect(spent).not.toContain('$');
        expect(spent).toContain('€');
    });

    test('day headers are localized', () => {
        // A date far from today so it takes the weekday/month branch rather
        // than Today/Yesterday.
        document.body.innerHTML = '<div id="expenses-list"></div>';
        ui.renderExpenses(
            [{ id: 'EXP#1#a', amount: 5, description: 'Brot', created_at: '2026-02-04T12:00:00Z' }],
            { onDelete() {}, onEdit() {}, onLoadMore() {} });
        const header = document.querySelector('.day-header').textContent;
        // de-DE renders the short month as "Feb." and never as the en-US "Feb".
        expect(header).toMatch(/Feb/);
        expect(header).not.toBe('Wed, Feb 4');
    });

    test('the carried-over chip localizes the previous month name', () => {
        document.body.innerHTML = `
            <div id="month-title"></div>
            <div id="carryover-chip" class="hidden"><span class="chip-label"></span><span class="chip-value"></span></div>
            <div id="month-balance"></div>
            <div id="total-balance"></div>
            <div id="expenses-total"></div>
            <div id="expenses-list"></div>`;
        ui.updateDashboard({
            month: '2026-03',
            summary: { starting_balance: 50, allowance_added: 100, total_expenses: 20, ending_balance: 130 },
            total_balance: 130,
            expenses: [],
        });
        const label = document.querySelector('#carryover-chip .chip-label').textContent;
        expect(label).toContain('Februar');
        expect(label).not.toContain('February');
    });

    test('a month key is not shifted by the viewer timezone', () => {
        // The month is a calendar month, not an instant. Formatting a
        // locally-constructed first-of-month renders the PREVIOUS month for any
        // viewer west of UTC; building and formatting in UTC avoids that.
        expect(ui.formatMonthName('2026-01')).toBe('Januar 2026');
        expect(ui.formatMonthName('2026-01')).not.toContain('Dezember');
    });

    test('an unusable locale/currency pair falls back instead of throwing', async () => {
        window.PASSBOOK_FORMAT = { locale: 'not-a-locale!!', currency: 'NOPE' };
        const bad = await import('../js/ui.js?locale=broken');
        // Must still produce something rather than blanking every amount.
        expect(typeof bad.formatCurrency(1)).toBe('string');
        expect(bad.formatCurrency(1).length).toBeGreaterThan(0);
    });
});
