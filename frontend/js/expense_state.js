/**
 * Pure, DOM-free helpers for the optimistic expense-delete / undo flow so the
 * delta math can be unit tested in isolation (see CI bun checks).
 *
 * These operate on a lightweight in-memory month state of the shape:
 *   { expenses: Expense[], summary: { total_expenses, ending_balance }, total_balance }
 * mutating it in place to mirror what app.js holds. They return enough info to
 * reverse the operation exactly.
 *
 * @module expense_state
 */

import { roundCents } from './api.js';

/**
 * Removes the expense with the given id from `state`, adjusting summary totals
 * and total_balance to refund the removed amount (mirrors the server's delete
 * accounting). Returns a record describing the removal so it can be undone with
 * `insertExpense`, or null if the id wasn't present.
 *
 * @param {Object} state - in-memory month state (mutated)
 * @param {string} expenseId
 * @returns {{ expense: Object, index: number }|null}
 */
export function removeExpense(state, expenseId) {
    if (!state || !Array.isArray(state.expenses)) return null;
    const index = state.expenses.findIndex((e) => e.id === expenseId);
    if (index === -1) return null;
    const expense = state.expenses[index];
    const amount = parseFloat(expense.amount) || 0;

    state.expenses.splice(index, 1);
    if (state.summary) {
        state.summary.total_expenses = roundCents((state.summary.total_expenses || 0) - amount);
        if (state.summary.ending_balance !== undefined) {
            state.summary.ending_balance = roundCents((state.summary.ending_balance || 0) + amount);
        }
    }
    state.total_balance = roundCents((state.total_balance || 0) + amount);
    return { expense, index };
}

/**
 * Re-inserts a previously-removed expense at `index`, undoing the summary /
 * total_balance refund that `removeExpense` applied. Used by Undo and by the
 * "DELETE failed → restore" path. Clamps the index into range so a list that
 * changed length in between still gets a sane insertion.
 *
 * @param {Object} state - in-memory month state (mutated)
 * @param {Object} expense
 * @param {number} index - original position
 */
export function insertExpense(state, expense, index) {
    if (!state || !Array.isArray(state.expenses) || !expense) return;
    const amount = parseFloat(expense.amount) || 0;
    const at = Math.max(0, Math.min(index, state.expenses.length));
    state.expenses.splice(at, 0, expense);
    if (state.summary) {
        state.summary.total_expenses = roundCents((state.summary.total_expenses || 0) + amount);
        if (state.summary.ending_balance !== undefined) {
            state.summary.ending_balance = roundCents((state.summary.ending_balance || 0) - amount);
        }
    }
    state.total_balance = roundCents((state.total_balance || 0) - amount);
}
