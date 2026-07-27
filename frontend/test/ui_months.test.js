import { test, expect, describe, beforeEach } from 'bun:test';
import * as ui from '../js/ui.js';

describe('months list', () => {
    beforeEach(() => {
        document.body.innerHTML = '<ul id="months-list"></ul>';
    });

    const rows = () => Array.from(document.querySelectorAll('#months-list .month-row'));
    const monthsFixture = [
        { month: '2026-03', monthly_saved: 40, total_expenses: 60 },
        { month: '2026-02', monthly_saved: -10, total_expenses: 110 },
        { month: '2026-01', monthly_saved: 100, total_expenses: 0 },
    ];

    // maxMonthExpenses scales the per-row spend bar. It reads total_expenses,
    // which the API omitted entirely — so the scale was always 0, the
    // `maxExpenses > 0` guard never passed, and the bar could not render.
    test('maxMonthExpenses picks the largest spend', () => {
        expect(ui.maxMonthExpenses(monthsFixture)).toBe(110);
        expect(ui.maxMonthExpenses([])).toBe(0);
        expect(ui.maxMonthExpenses(null)).toBe(0);
        // A payload from a server that predates the field must not throw.
        expect(ui.maxMonthExpenses([{ month: '2026-01', monthly_saved: 5 }])).toBe(0);
    });

    test('renders a spend bar scaled against the largest month', () => {
        ui.renderMonthsList(monthsFixture, '2026-03', () => {});
        const fills = document.querySelectorAll('.month-spend-fill');
        expect(fills.length).toBe(3);
        // 60/110 -> 55%, 110/110 -> 100%, 0/110 -> 0%
        expect(fills[0].style.getPropertyValue('--w')).toBe('55%');
        expect(fills[1].style.getPropertyValue('--w')).toBe('100%');
        expect(fills[2].style.getPropertyValue('--w')).toBe('0%');
    });

    test('omits the spend bar entirely when no month has spend', () => {
        ui.renderMonthsList([{ month: '2026-01', monthly_saved: 100, total_expenses: 0 }],
            '2026-01', () => {});
        expect(document.querySelectorAll('.month-spend-bar').length).toBe(0);
    });

    test('marks the current month', () => {
        ui.renderMonthsList(monthsFixture, '2026-02', () => {});
        const active = document.querySelectorAll('.month-item.active');
        expect(active.length).toBe(1);
        expect(active[0].dataset.month).toBe('2026-02');
        expect(active[0].getAttribute('aria-current')).toBe('true');
    });

    describe('delete affordance', () => {
        test('appears only for months with nothing spent', () => {
            ui.renderMonthsList(monthsFixture, '2026-03', () => {}, null, null, () => {});
            const withDelete = rows()
                .filter(r => r.querySelector('.month-delete'))
                .map(r => r.querySelector('.month-item').dataset.month);
            expect(withDelete).toEqual(['2026-01']);
        });

        test('is absent when no delete handler is supplied', () => {
            ui.renderMonthsList(monthsFixture, '2026-03', () => {});
            expect(document.querySelectorAll('.month-delete').length).toBe(0);
        });

        test('invokes onDelete with the month and does NOT also select it', () => {
            const selected = [];
            const deleted = [];
            ui.renderMonthsList(monthsFixture, '2026-03',
                (m) => selected.push(m), null, null, (m) => deleted.push(m));

            document.querySelector('.month-delete').dispatchEvent(
                new window.Event('click', { bubbles: true }));

            expect(deleted).toEqual(['2026-01']);
            // The control sits inside the row next to the month button; a
            // click must not double as a month switch.
            expect(selected).toEqual([]);
        });

        test('selecting a month still works alongside the delete control', () => {
            const selected = [];
            ui.renderMonthsList(monthsFixture, '2026-03',
                (m) => selected.push(m), null, null, () => {});
            document.querySelector('.month-item[data-month="2026-01"]').click();
            expect(selected).toEqual(['2026-01']);
        });
    });
});

// formatCurrency drives every amount on screen. It hardcoded en-US/USD while
// everything else about an instance — theme, PWA identity, wording — was
// configurable, so a non-dollar deployment had no way to render its own
// currency. It now reads window.PASSBOOK_FORMAT, which CI bakes from the
// `format:` block of the instance YAML.
describe('currency formatting', () => {
    test('defaults to USD when no format config is injected', () => {
        expect(ui.formatCurrency(1234.5)).toBe('$1,234.50');
        expect(ui.formatCurrency(-10)).toBe('-$10.00');
        expect(ui.formatCurrency(0)).toBe('$0.00');
    });
});
