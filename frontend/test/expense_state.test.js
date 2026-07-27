import { test, expect, describe } from 'bun:test';
import { removeExpense, insertExpense } from '../js/expense_state.js';

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
