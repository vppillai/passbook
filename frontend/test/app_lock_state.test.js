import { test, expect, describe } from 'bun:test';
import { App } from '../js/app.js';

// Locking clears the session token and purges the HTTP cache, but every piece of
// decrypted state the app was holding in MEMORY survived: monthCache,
// monthsListData, monthData, allExpenses. loadMonthView serves a monthCache entry
// verbatim, so the next unlock repainted the previous session's figures with no
// network call at all — lock the app, come back a day later, and the dashboard
// shows yesterday's numbers as though they were current, with nothing to
// indicate otherwise.
//
// A pending delete makes it worse: the row is already gone locally but its
// DELETE was never sent, so the cached month describes a state the server never
// reached.
describe('clearing view state on lock', () => {
    const populated = () => {
        const app = new App();
        app.currentMonth = '2026-03';
        app.monthData = { total_balance: 100, summary: { total_expenses: 20 } };
        app.allExpenses = [{ id: 'EXP#1#a', amount: 20 }];
        app.expensesCursor = 'opaque-cursor';
        app.monthCache.set('2026-03', { expenses: [{ id: 'EXP#1#a' }] });
        app.monthCache.set('2026-02', { expenses: [] });
        app.monthsListData = { months: [{ month: '2026-03' }] };
        app.monthsListDirty = false;
        app.editingExpenseId = 'EXP#1#a';
        app.editingOriginalDate = '2026-03-04';
        return app;
    };

    test('drops every cached month, not just the current one', () => {
        const app = populated();
        app.clearViewState();
        expect(app.monthCache.size).toBe(0);
    });

    test('drops the months list and marks it dirty so the menu refetches', () => {
        const app = populated();
        app.clearViewState();
        expect(app.monthsListData).toBeNull();
        expect(app.monthsListDirty).toBe(true);
    });

    test('drops the rendered month and its expenses', () => {
        const app = populated();
        app.clearViewState();
        expect(app.monthData).toBeNull();
        expect(app.allExpenses).toEqual([]);
        expect(app.expensesCursor).toBeNull();
    });

    test('abandons any half-finished edit', () => {
        const app = populated();
        app.clearViewState();
        expect(app.editingExpenseId).toBeNull();
        expect(app.editingOriginalDate).toBeNull();
    });

    test('leaves a pending delete for the caller to flush', () => {
        // clearViewState must not quietly discard it: the caller commits the
        // DELETE while the session is still valid, then clears. Nulling it here
        // would drop the user's delete on the floor instead.
        const app = populated();
        app.pendingDelete = { month: '2026-03', expenseId: 'EXP#1#a', expense: { amount: 20 }, index: 0 };
        app.clearViewState();
        expect(app.pendingDelete).not.toBeNull();
    });

    test('a fresh App and a cleared App hold the same view state', () => {
        // The point of the reset is that unlocking starts from nothing, so
        // anything a new instance would have must match.
        const cleared = populated();
        cleared.clearViewState();
        const fresh = new App();
        for (const key of ['monthData', 'allExpenses', 'expensesCursor',
            'editingExpenseId', 'editingOriginalDate', 'monthsListData', 'monthsListDirty']) {
            expect(cleared[key]).toEqual(fresh[key]);
        }
        expect(cleared.monthCache.size).toBe(fresh.monthCache.size);
    });
});

// The undo-window reconciliation needs to know how much a not-yet-sent delete is
// worth, and only for the month it belongs to.
describe('pending delete refund lookup', () => {
    test('reports the amount for the month the delete belongs to', () => {
        const app = new App();
        app.pendingDelete = { month: '2026-03', expense: { amount: 12.5 } };
        expect(app.pendingDeleteRefund('2026-03')).toBe(12.5);
    });

    test('reports nothing for a different month', () => {
        const app = new App();
        app.pendingDelete = { month: '2026-03', expense: { amount: 12.5 } };
        expect(app.pendingDeleteRefund('2026-02')).toBe(0);
    });

    test('reports nothing when no delete is pending', () => {
        expect(new App().pendingDeleteRefund('2026-03')).toBe(0);
    });

    test('tolerates a string amount and a malformed record', () => {
        const app = new App();
        app.pendingDelete = { month: '2026-03', expense: { amount: '7.25' } };
        expect(app.pendingDeleteRefund('2026-03')).toBe(7.25);
        app.pendingDelete = { month: '2026-03' };
        expect(app.pendingDeleteRefund('2026-03')).toBe(0);
    });
});
