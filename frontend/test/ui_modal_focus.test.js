import { test, expect, describe, beforeEach } from 'bun:test';
import * as ui from '../js/ui.js';

// A background control plus a modal holding three focusables. aria-modal is
// advisory only — it tells assistive tech the rest of the page is inert, but
// does nothing about Tab, so without a trap keyboard users walk straight out of
// an open dialog into content that is visually behind a backdrop.
const HTML = `
<button id="outside-before">before</button>
<div id="test-modal" class="modal hidden" role="dialog" aria-modal="true">
  <div class="modal-backdrop"></div>
  <div class="modal-content">
    <form>
      <input id="m-first" type="text">
      <input id="m-second" type="text">
      <button type="submit" id="m-last">Save</button>
    </form>
  </div>
</div>
<button id="outside-after">after</button>`;

describe('modal focus management', () => {
    beforeEach(() => {
        document.body.innerHTML = HTML;
    });

    const id = (x) => document.getElementById(x);
    const tab = (shift = false) => {
        const ev = new window.KeyboardEvent('keydown', {
            key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true,
        });
        (document.activeElement || document.body).dispatchEvent(ev);
        return ev;
    };

    test('focuses the first control on open', () => {
        ui.showModal('test-modal');
        expect(document.activeElement.id).toBe('m-first');
    });

    test('Tab from the last control wraps to the first', () => {
        ui.showModal('test-modal');
        id('m-last').focus();
        const ev = tab();
        expect(ev.defaultPrevented).toBe(true);
        expect(document.activeElement.id).toBe('m-first');
    });

    test('Shift+Tab from the first control wraps to the last', () => {
        ui.showModal('test-modal');
        id('m-first').focus();
        const ev = tab(true);
        expect(ev.defaultPrevented).toBe(true);
        expect(document.activeElement.id).toBe('m-last');
    });

    test('Tab between interior controls is left to the browser', () => {
        ui.showModal('test-modal');
        id('m-first').focus();
        const ev = tab();
        // Not at a boundary, so the trap must not interfere with native order.
        expect(ev.defaultPrevented).toBe(false);
    });

    test('focus escaping to background content is pulled back in', () => {
        ui.showModal('test-modal');
        // Simulates what a real browser does if anything moves focus outside
        // while the dialog is open.
        id('outside-after').focus();
        expect(document.activeElement.id).not.toBe('outside-after');
        expect(document.getElementById('test-modal').contains(document.activeElement)).toBe(true);
    });

    test('the trap is released on close and focus returns to the trigger', () => {
        id('outside-before').focus();
        ui.showModal('test-modal');
        expect(document.activeElement.id).toBe('m-first');

        ui.hideModal('test-modal');
        expect(document.activeElement.id).toBe('outside-before');

        // With the modal closed, Tab must be the browser's business again.
        id('outside-after').focus();
        const ev = tab();
        expect(ev.defaultPrevented).toBe(false);
        expect(document.activeElement.id).toBe('outside-after');
    });

    test('does not leak a keydown listener per open/close cycle', () => {
        const listenerCount = (el, type) => {
            const sym = Object.getOwnPropertySymbols(el)
                .find(s => String(s) === 'Symbol(listeners)');
            return el[sym]?.bubbling?.get(type)?.length ?? 0;
        };
        const before = listenerCount(document, 'keydown');
        for (let i = 0; i < 5; i++) {
            ui.showModal('test-modal');
            ui.hideModal('test-modal');
        }
        expect(listenerCount(document, 'keydown')).toBe(before);
    });
});

// The change-PIN modal is the real shape that matters: each field has a
// show/hide toggle whose two icon <svg>s swap via the `.hidden` class, and the
// modal itself is position:fixed. Visibility must be judged by that class, not
// by layout — offsetParent is null for fixed elements, so a layout-based check
// would report every control as unfocusable and silently disable the trap.
describe('focusable detection matches the app\'s own hiding mechanism', () => {
    beforeEach(() => {
        document.body.innerHTML = `
        <div id="pin-modal" class="modal hidden" role="dialog" aria-modal="true">
          <div class="modal-content">
            <form>
              <input id="p-current" type="password">
              <button type="button" class="btn-show-pin" id="p-toggle">
                <svg class="icon-eye"></svg>
                <svg class="icon-eye-off hidden"></svg>
              </button>
              <div class="hidden"><button id="p-buried">buried</button></div>
              <button type="submit" id="p-submit">Change</button>
            </form>
          </div>
        </div>`;
    });

    test('includes real controls and excludes ones inside a .hidden subtree', () => {
        ui.showModal('pin-modal');
        // First focusable is the input, and Tab must cycle through exactly the
        // three visible controls — never the button buried in .hidden.
        expect(document.activeElement.id).toBe('p-current');

        const seen = new Set();
        for (let i = 0; i < 6; i++) {
            seen.add(document.activeElement.id);
            const ev = new window.KeyboardEvent('keydown', {
                key: 'Tab', bubbles: true, cancelable: true,
            });
            document.activeElement.dispatchEvent(ev);
            if (!ev.defaultPrevented) {
                // Not a boundary: emulate the browser advancing focus.
                const order = ['p-current', 'p-toggle', 'p-submit'];
                const idx = order.indexOf(document.activeElement.id);
                document.getElementById(order[Math.min(idx + 1, order.length - 1)]).focus();
            }
        }
        expect(seen.has('p-buried')).toBe(false);
        expect(seen.has('p-current')).toBe(true);
        expect(seen.has('p-submit')).toBe(true);
    });

    test('wrapping still works when the dialog is position:fixed', () => {
        ui.showModal('pin-modal');
        document.getElementById('p-submit').focus();
        const ev = new window.KeyboardEvent('keydown', {
            key: 'Tab', bubbles: true, cancelable: true,
        });
        document.activeElement.dispatchEvent(ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(document.activeElement.id).toBe('p-current');
    });
});
