import { test, expect, describe, beforeEach } from 'bun:test';
import * as ui from '../js/ui.js';

// showUndoToast defers a real action (the expense DELETE) behind a timer and
// promises that EXACTLY ONE of onUndo / onExpire fires. Every path that
// supersedes the toast has to honour that, or the deferred action is
// silently abandoned.
describe('undo toast settlement', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="toast" class="toast hidden"></div>';
    });

    const toastEl = () => document.getElementById('toast');

    test('a plain toast commits a pending undo instead of dropping it', async () => {
        const calls = [];
        ui.showUndoToast({
            message: 'Expense deleted',
            actionText: 'Undo',
            durationMs: 5000,
            onUndo: () => calls.push('undo'),
            onExpire: () => calls.push('expire'),
        });
        expect(toastEl().querySelector('.toast-undo')).not.toBeNull();

        // Any other action in the app can raise a plain toast — adding funds,
        // saving an edit. It replaces the toast's children, so the Undo
        // button disappears and the user can no longer act on it. The
        // deferred delete must therefore be committed, not left dangling.
        ui.showToast('Funds added!', 'success');

        expect(calls).toEqual(['expire']);
        expect(toastEl().querySelector('.toast-undo')).toBeNull();
        expect(toastEl().textContent).toBe('Funds added!');
    });

    test('a superseded undo timer does not later hide the new toast', async () => {
        let expired = 0;
        ui.showUndoToast({
            message: 'Expense deleted',
            actionText: 'Undo',
            durationMs: 30,
            onUndo: () => {},
            onExpire: () => { expired++; },
        });
        ui.showToast('Funds added!', 'success');
        expect(toastEl().classList.contains('hidden')).toBe(false);

        // Past the undo toast's original deadline: its timer must be dead, so
        // it can neither fire a second time nor hide the plain toast that
        // replaced it.
        await new Promise(r => setTimeout(r, 60));

        expect(expired).toBe(1);
        expect(toastEl().classList.contains('hidden')).toBe(false);
        expect(toastEl().textContent).toBe('Funds added!');
    });

    test('tapping Undo fires onUndo and never onExpire', async () => {
        const calls = [];
        ui.showUndoToast({
            message: 'Expense deleted',
            actionText: 'Undo',
            durationMs: 30,
            onUndo: () => calls.push('undo'),
            onExpire: () => calls.push('expire'),
        });
        toastEl().querySelector('.toast-undo').click();
        await new Promise(r => setTimeout(r, 60));
        expect(calls).toEqual(['undo']);
    });

    test('expiry fires onExpire exactly once', async () => {
        const calls = [];
        ui.showUndoToast({
            message: 'Expense deleted',
            actionText: 'Undo',
            durationMs: 20,
            onUndo: () => calls.push('undo'),
            onExpire: () => calls.push('expire'),
        });
        await new Promise(r => setTimeout(r, 60));
        expect(calls).toEqual(['expire']);
    });

    test('a second undo toast commits the first', () => {
        const calls = [];
        ui.showUndoToast({
            message: 'first', actionText: 'Undo', durationMs: 5000,
            onUndo: () => calls.push('undo-1'),
            onExpire: () => calls.push('expire-1'),
        });
        ui.showUndoToast({
            message: 'second', actionText: 'Undo', durationMs: 5000,
            onUndo: () => calls.push('undo-2'),
            onExpire: () => calls.push('expire-2'),
        });
        expect(calls).toEqual(['expire-1']);
    });

    test('flushUndoToast commits and is safe to call with nothing pending', () => {
        const calls = [];
        ui.showUndoToast({
            message: 'x', actionText: 'Undo', durationMs: 5000,
            onUndo: () => calls.push('undo'),
            onExpire: () => calls.push('expire'),
        });
        ui.flushUndoToast();
        ui.flushUndoToast();
        expect(calls).toEqual(['expire']);
    });
});
