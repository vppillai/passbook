import { test, expect, describe } from 'bun:test';
import { removeExpense, insertExpense, adjustForPendingDelete } from '../js/expense_state.js';

// These helpers back the optimistic delete/undo flow: the row disappears and
// the totals move before the server is told anything, and Undo has to put
// both back EXACTLY. Any asymmetry shows up as a dashboard that silently
// disagrees with the server after an undo.
const newState = () => ({
    expenses: [
        { id: 'EXP#3#c', amount: 5.25, description: 'c' },
        { id: 'EXP#2#b', amount: 10, description: 'b' },
        { id: 'EXP#1#a', amount: 0.1, description: 'a' },
    ],
    summary: { total_expenses: 15.35, ending_balance: 84.65 },
    total_balance: 84.65,
});

describe('removeExpense', () => {
    test('drops the row and refunds its amount to both totals', () => {
        const state = newState();
        const removed = removeExpense(state, 'EXP#2#b');

        expect(removed).not.toBeNull();
        expect(removed.index).toBe(1);
        expect(removed.expense.id).toBe('EXP#2#b');
        expect(state.expenses.map(e => e.id)).toEqual(['EXP#3#c', 'EXP#1#a']);
        expect(state.summary.total_expenses).toBe(5.35);
        expect(state.summary.ending_balance).toBe(94.65);
        expect(state.total_balance).toBe(94.65);
    });

    test('returns null for an unknown id and leaves state untouched', () => {
        const state = newState();
        expect(removeExpense(state, 'EXP#9#zz')).toBeNull();
        expect(state.expenses).toHaveLength(3);
        expect(state.total_balance).toBe(84.65);
    });

    test('tolerates a missing or malformed state', () => {
        expect(removeExpense(null, 'x')).toBeNull();
        expect(removeExpense({}, 'x')).toBeNull();
        expect(removeExpense({ expenses: 'nope' }, 'x')).toBeNull();
    });
});

describe('remove then insert (the Undo path)', () => {
    test('restores the row, its position, and every total exactly', () => {
        const state = newState();
        const before = JSON.parse(JSON.stringify(state));

        const removed = removeExpense(state, 'EXP#2#b');
        insertExpense(state, removed.expense, removed.index);

        expect(state).toEqual(before);
    });

    test('round-trips a fractional amount without float drift', () => {
        // 0.1 is the classic case: naive subtract-then-add leaves 84.64999…
        // and the dashboard renders a cent that does not exist.
        const state = newState();
        const before = JSON.parse(JSON.stringify(state));

        const removed = removeExpense(state, 'EXP#1#a');
        expect(state.total_balance).toBe(84.75);
        insertExpense(state, removed.expense, removed.index);

        expect(state).toEqual(before);
    });

    test('round-trips every row in turn', () => {
        for (const id of ['EXP#3#c', 'EXP#2#b', 'EXP#1#a']) {
            const state = newState();
            const before = JSON.parse(JSON.stringify(state));
            const removed = removeExpense(state, id);
            insertExpense(state, removed.expense, removed.index);
            expect(state).toEqual(before);
        }
    });
});

describe('insertExpense', () => {
    test('clamps an out-of-range index instead of leaving a hole', () => {
        // The list can change length while the undo toast is up, so the
        // remembered index may no longer be valid.
        const state = newState();
        insertExpense(state, { id: 'EXP#9#z', amount: 1 }, 99);
        expect(state.expenses).toHaveLength(4);
        expect(state.expenses[3].id).toBe('EXP#9#z');

        const state2 = newState();
        insertExpense(state2, { id: 'EXP#9#z', amount: 1 }, -5);
        expect(state2.expenses[0].id).toBe('EXP#9#z');
    });

    test('ignores a missing expense or state', () => {
        const state = newState();
        insertExpense(state, null, 0);
        expect(state.expenses).toHaveLength(3);
        expect(() => insertExpense(null, { amount: 1 }, 0)).not.toThrow();
    });

    test('treats a non-numeric amount as zero rather than NaN-ing the ledger', () => {
        const state = newState();
        insertExpense(state, { id: 'EXP#9#z', amount: undefined }, 0);
        expect(state.total_balance).toBe(84.65);
        expect(state.summary.total_expenses).toBe(15.35);
    });
});

// A deferred delete removes the row and refunds its amount LOCALLY, then holds
// the DELETE for 5s so Undo can cancel it. During that window the server has no
// idea the expense is going away — so any response it sends carries absolute
// figures computed from a world where the expense still exists.
//
// applyExpenseUpdate and applyFundsUpdate both assigned those absolutes straight
// onto the live model (`total_balance = res.total_balance`, and addFunds replaced
// `summary` wholesale). Editing an expense or topping up during the undo window
// therefore silently discarded the refund: the balance dropped back by the
// pending amount and stayed wrong, because when the DELETE finally fires the
// server applies it to ITS state and the client never re-reads.
describe('reconciling a server snapshot against a pending delete', () => {
    test('adds the pending refund back onto an absolute total_balance', () => {
        const out = adjustForPendingDelete({ total_balance: 70 }, 30);
        expect(out.total_balance).toBe(100);
    });

    test('leaves the snapshot alone when nothing is pending', () => {
        const snapshot = { total_balance: 70, summary: { total_expenses: 30, ending_balance: 70 } };
        const out = adjustForPendingDelete(snapshot, 0);
        expect(out.total_balance).toBe(70);
        expect(out.summary.total_expenses).toBe(30);
        expect(out.summary.ending_balance).toBe(70);
    });

    test('adjusts a wholesale summary replacement too', () => {
        // addFunds returns the whole summary, so every figure in it predates the
        // pending delete.
        const out = adjustForPendingDelete(
            { total_balance: 170, summary: { total_expenses: 30, ending_balance: 170 } }, 30);
        expect(out.summary.total_expenses).toBe(0);
        expect(out.summary.ending_balance).toBe(200);
        expect(out.total_balance).toBe(200);
    });

    test('does not mutate the response object', () => {
        const snapshot = { total_balance: 70, summary: { total_expenses: 30, ending_balance: 70 } };
        adjustForPendingDelete(snapshot, 30);
        expect(snapshot.total_balance).toBe(70);
        expect(snapshot.summary.total_expenses).toBe(30);
    });

    test('rounds to cents rather than accumulating float dust', () => {
        const out = adjustForPendingDelete({ total_balance: 0.1 }, 0.2);
        expect(out.total_balance).toBe(0.3);
    });

    test('tolerates a snapshot with no summary', () => {
        const out = adjustForPendingDelete({ total_balance: 5 }, 1);
        expect(out.total_balance).toBe(6);
        expect(out.summary).toBeUndefined();
    });

    test('tolerates a snapshot with no total_balance', () => {
        // An older server, or a response shape that omits it: the field must stay
        // absent rather than becoming the bare refund.
        const out = adjustForPendingDelete({ summary: { total_expenses: 30, ending_balance: 70 } }, 30);
        expect(out.total_balance).toBeUndefined();
        expect(out.summary.total_expenses).toBe(0);
    });

    // The round trip is the real invariant: applying a snapshot mid-undo-window
    // and then committing the delete must land on the same figures as committing
    // the delete first and then applying the snapshot.
    test('is equivalent to the server having known about the delete', () => {
        const pendingAmount = 30;
        const serverAfterDelete = { total_balance: 200, summary: { total_expenses: 0, ending_balance: 200 } };
        const serverBeforeDelete = { total_balance: 170, summary: { total_expenses: 30, ending_balance: 170 } };
        const reconciled = adjustForPendingDelete(serverBeforeDelete, pendingAmount);
        expect(reconciled).toEqual(serverAfterDelete);
    });
});
