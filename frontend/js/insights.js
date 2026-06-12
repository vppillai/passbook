/**
 * Spending-insights pure helpers (no DOM, no network) so they can be unit
 * tested in isolation (see the bun checks in CI / the UX report).
 *
 * @module insights
 */

import { roundCents } from './api.js';

/**
 * Returns the number of days in the given "YYYY-MM" month, handling leap
 * years via the JS Date day-0-of-next-month trick.
 * @param {string} monthKey - "YYYY-MM"
 * @returns {number} days in the month (28–31), or 0 if the key is malformed
 */
export function daysInMonth(monthKey) {
    const m = /^(\d{4})-(\d{1,2})$/.exec(String(monthKey || ''));
    if (!m) return 0;
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    if (month < 1 || month > 12) return 0;
    // Day 0 of the next month is the last day of this month.
    return new Date(year, month, 0).getDate();
}

/**
 * Computes a spending-pace insight for the CURRENT month only. Pure: callers
 * pass `now` so the result is deterministic and testable.
 *
 * Budget = allowance_added + max(starting_balance, 0) — i.e. this month's
 * fresh allowance plus any positive carry-in. A negative carry (debt) is NOT
 * treated as spendable, so it's floored at 0.
 *
 * @param {Object} params
 * @param {string} params.month - "YYYY-MM" month key of the row being shown
 * @param {Object} params.summary - { allowance_added, total_expenses, starting_balance }
 * @param {Date}   [params.now=new Date()] - clock (injected for tests)
 * @returns {{kind: 'on_track'|'overspend'|'saved', amount: number}|null}
 *   null when there is no meaningful insight to show (no allowance/budget,
 *   malformed month, or divide-by-zero conditions).
 */
export function computePace({ month, summary, now = new Date() }) {
    if (!summary) return null;

    const allowance = Number(summary.allowance_added) || 0;
    const carry = Math.max(Number(summary.starting_balance) || 0, 0);
    const budget = roundCents(allowance + carry);
    const spent = roundCents(Number(summary.total_expenses) || 0);

    // Guard: no allowance and no positive carry → no budget to pace against.
    if (allowance <= 0 && budget <= 0) return null;
    if (budget <= 0) return null;

    const totalDays = daysInMonth(month);
    if (totalDays <= 0) return null;

    // Day-of-month, clamped to [1, totalDays]. day 1 = first day, last day OK.
    const day = Math.min(Math.max(now.getDate(), 1), totalDays);
    const daysRemaining = totalDays - day; // 0 on the last day

    const remainingBudget = roundCents(budget - spent);

    // Already over budget for the month: report the overspend, but only when
    // it's meaningful (>= 1 cent). The caller decides styling.
    if (remainingBudget < -0.005) {
        return { kind: 'overspend', amount: roundCents(-remainingBudget) };
    }

    // On the last day (no days remaining): if we didn't overspend, we saved
    // whatever is left. Avoids a divide-by-zero on the per-day rate.
    if (daysRemaining <= 0) {
        return { kind: 'saved', amount: remainingBudget };
    }

    // Expected spend so far at an even daily pace, vs. actual.
    const idealDailyRate = budget / totalDays;
    const expectedSoFar = idealDailyRate * day;

    // Spending ahead of an even pace by a meaningful margin → overspend
    // projection (how much over the even pace we are right now).
    const overPace = roundCents(spent - expectedSoFar);
    if (overPace >= 0.01 && spent > expectedSoFar) {
        return { kind: 'overspend', amount: overPace };
    }

    // On or under pace: surface the safe daily spend for the rest of the month.
    const perDayLeft = roundCents(remainingBudget / (daysRemaining + 1));
    return { kind: 'on_track', amount: Math.max(perDayLeft, 0) };
}

/**
 * Returns true when the given "YYYY-MM" key is the same calendar month as
 * `now` (local time). Pace is only shown for the live/current month.
 * @param {string} monthKey
 * @param {Date} [now=new Date()]
 * @returns {boolean}
 */
export function isCurrentMonth(monthKey, now = new Date()) {
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return monthKey === key;
}
