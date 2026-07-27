import { test, expect, describe, beforeEach } from 'bun:test';
import * as ui from '../js/ui.js';

const CONFIRM_MODAL_HTML = `
<div id="confirm-modal" class="modal hidden">
  <div class="modal-backdrop"></div>
  <div class="modal-content">
    <h2 id="confirm-modal-title"></h2>
    <p id="confirm-modal-body"></p>
    <button type="button" id="confirm-modal-cancel"></button>
    <button type="button" id="confirm-modal-confirm"></button>
  </div>
</div>`;

describe('showConfirm', () => {
    beforeEach(() => {
        document.body.innerHTML = CONFIRM_MODAL_HTML;
    });

    const backdrop = () => document.querySelector('#confirm-modal .modal-backdrop');
    const confirmBtn = () => document.getElementById('confirm-modal-confirm');
    const cancelBtn = () => document.getElementById('confirm-modal-cancel');

    test('resolves true on confirm and false on cancel', async () => {
        const p1 = ui.showConfirm({ title: 'a' });
        confirmBtn().click();
        expect(await p1).toBe(true);

        const p2 = ui.showConfirm({ title: 'b' });
        cancelBtn().click();
        expect(await p2).toBe(false);
    });

    test('resolves false on a backdrop click', async () => {
        const p = ui.showConfirm({ title: 'a' });
        backdrop().click();
        expect(await p).toBe(false);
    });

    test('resolves false on Escape', async () => {
        const p = ui.showConfirm({ title: 'a' });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(await p).toBe(false);
    });

    // Counts registered listeners of a type via happy-dom's internal
    // registry. Poking at internals is justified here: the defect is
    // unbounded listener accumulation, which has no other observable
    // signature — resolve() is idempotent, so the stale handlers do their
    // damage silently as a leak rather than as wrong behaviour.
    const listenerCount = (el, type) => {
        const sym = Object.getOwnPropertySymbols(el)
            .find(s => String(s) === 'Symbol(listeners)');
        return el[sym]?.bubbling?.get(type)?.length ?? 0;
    };

    // The backdrop handler was registered with {once:true}, which only
    // removes itself when it FIRES — so every confirm resolved by a button
    // or by Escape left its listener attached forever. Each one closes over
    // a dead promise and the whole pile runs on the next backdrop click.
    test('does not accumulate backdrop listeners across calls', async () => {
        for (let i = 0; i < 5; i++) {
            const p = ui.showConfirm({ title: `run-${i}` });
            confirmBtn().click();
            await p;
        }
        expect(listenerCount(backdrop(), 'click')).toBe(0);

        // One open confirm should hold exactly one.
        const open = ui.showConfirm({ title: 'open' });
        expect(listenerCount(backdrop(), 'click')).toBe(1);
        backdrop().click();
        expect(await open).toBe(false);
        expect(listenerCount(backdrop(), 'click')).toBe(0);
    });

    // Same leak on the keydown path: the Escape handler is attached to
    // document, so a build-up there is process-wide, not modal-scoped.
    test('does not accumulate document keydown listeners across calls', async () => {
        const before = listenerCount(document, 'keydown');
        for (let i = 0; i < 5; i++) {
            const p = ui.showConfirm({ title: `run-${i}` });
            cancelBtn().click();
            await p;
        }
        expect(listenerCount(document, 'keydown')).toBe(before);
    });

    test('a settled confirm ignores later Escape presses', async () => {
        const p = ui.showConfirm({ title: 'a' });
        confirmBtn().click();
        expect(await p).toBe(true);

        // Open an unrelated confirm; the previous call's Escape handler must
        // be gone, so this one resolves exactly once, to its own outcome.
        const p2 = ui.showConfirm({ title: 'b' });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(await p2).toBe(false);
    });
});
