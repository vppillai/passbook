import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as ui from '../js/ui.js';

// The history slide-out covers the screen behind a backdrop and visually owns it,
// exactly like a modal — but it got none of a modal's treatment. showMenu only
// toggled classes: no dialog semantics, no focus moved into the panel, no focus
// trap, no Escape, no focus restored on close. A keyboard or screen-reader user
// opening it was left with focus still on the page behind the backdrop, able to
// operate an app they could no longer see, with nothing announcing that a panel
// had opened.
//
// Every modal in this app already does this properly, so the panel was the one
// overlay that did not.
const MENU_FIXTURE = `
    <button id="menu-btn" aria-label="Menu"></button>
    <button id="behind">Behind the backdrop</button>
    <div id="menu-overlay" class="overlay hidden"></div>
    <div id="history-menu" class="menu hidden" role="dialog" aria-modal="true"
         aria-labelledby="history-menu-title">
        <div class="menu-header">
            <h2 id="history-menu-title">History</h2>
            <button id="new-month-btn">New</button>
            <button id="close-menu" aria-label="Close">X</button>
        </div>
        <ul id="months-list"></ul>
        <div class="menu-footer">
            <button id="logout-btn">Lock</button>
        </div>
    </div>`;

describe('history panel accessibility', () => {
    beforeEach(() => {
        document.body.innerHTML = MENU_FIXTURE;
    });
    afterEach(() => {
        // Leave no trap or timer behind for the next test.
        ui.hideMenu();
    });

    test('the panel is marked up as a modal dialog with an accessible name', () => {
        const menu = document.getElementById('history-menu');
        expect(menu.getAttribute('role')).toBe('dialog');
        expect(menu.getAttribute('aria-modal')).toBe('true');
        const labelledBy = menu.getAttribute('aria-labelledby');
        expect(labelledBy).toBeTruthy();
        expect(document.getElementById(labelledBy).textContent.trim()).toBeTruthy();
    });

    test('opening moves focus into the panel', () => {
        document.getElementById('menu-btn').focus();
        ui.showMenu();
        expect(document.getElementById('history-menu').contains(document.activeElement)).toBe(true);
    });

    test('Tab wraps from the last control back to the first', () => {
        ui.showMenu();
        // Park focus on the last control and Tab forward. Asserting merely
        // "still inside the panel" would pass with no trap at all, since focus
        // simply would not move; the wrap target is what proves one is
        // installed.
        document.getElementById('logout-btn').focus();
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        expect(document.activeElement.id).toBe('new-month-btn');
    });

    test('Shift+Tab wraps from the first control back to the last', () => {
        ui.showMenu();
        document.getElementById('new-month-btn').focus();
        document.dispatchEvent(new window.KeyboardEvent('keydown',
            { key: 'Tab', shiftKey: true, bubbles: true }));
        expect(document.activeElement.id).toBe('logout-btn');
    });

    test('focus moved outside is pulled back while the panel is open', () => {
        ui.showMenu();
        document.getElementById('behind').focus();
        document.getElementById('behind').dispatchEvent(
            new window.FocusEvent('focusin', { bubbles: true }));
        expect(document.getElementById('history-menu').contains(document.activeElement)).toBe(true);
    });

    test('closing returns focus to whatever opened it', () => {
        const opener = document.getElementById('menu-btn');
        opener.focus();
        ui.showMenu();
        // Focus really has to leave the opener first, or the restore below would
        // pass without anything restoring it.
        expect(document.activeElement).not.toBe(opener);
        ui.hideMenu();
        expect(document.activeElement).toBe(opener);
    });

    test('closing releases the trap immediately, not after the exit animation', () => {
        // hideMenu defers the class change by 300ms for the slide-out. Releasing
        // the trap on that timer would tear down a trap a modal opened FROM the
        // menu had since installed, since there is only one trap slot.
        const opener = document.getElementById('menu-btn');
        opener.focus();
        ui.showMenu();
        ui.hideMenu();
        document.getElementById('behind').focus();
        document.getElementById('behind').dispatchEvent(
            new window.FocusEvent('focusin', { bubbles: true }));
        expect(document.activeElement.id).toBe('behind');
    });

    test('isMenuOpen reports the panel state', () => {
        expect(ui.isMenuOpen()).toBe(false);
        ui.showMenu();
        expect(ui.isMenuOpen()).toBe(true);
        ui.hideMenu();
        expect(ui.isMenuOpen()).toBe(false);
    });

    test('closing an already-closed panel does not steal focus', () => {
        document.getElementById('behind').focus();
        ui.hideMenu();
        expect(document.activeElement.id).toBe('behind');
    });
});

// hideModal restored focus to the element that opened the modal, guarded only by
// document.contains(). That misses the common case: the opener is a button inside
// the history panel, which is display:none by the time the modal closes.
// .focus() on a display:none element silently does nothing, so focus fell to
// <body> and a keyboard user was dumped at the top of the document.
describe('modal focus restore', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <button id="menu-btn" aria-label="Menu"></button>
            <div id="panel" class="hidden">
                <button id="opener">Change PIN</button>
            </div>
            <div id="test-modal" class="modal hidden" role="dialog" aria-modal="true">
                <button id="inside">OK</button>
            </div>`;
    });

    test('does not leave focus on the body when the opener became invisible', () => {
        // Opener visible when it triggers the modal, hidden by the time it closes
        // — precisely what happens when the panel slides away behind the dialog.
        const panel = document.getElementById('panel');
        panel.classList.remove('hidden');
        document.getElementById('opener').focus();
        ui.showModal('test-modal');
        panel.classList.add('hidden');

        ui.hideModal('test-modal');

        expect(document.activeElement).not.toBe(document.body);
        expect(document.activeElement.id).toBe('menu-btn');
    });

    test('still returns focus to a visible opener', () => {
        const opener = document.getElementById('menu-btn');
        opener.focus();
        ui.showModal('test-modal');
        ui.hideModal('test-modal');
        expect(document.activeElement).toBe(opener);
    });
});

// The resting state of the month-delete control is its only affordance on a
// touch device, where :hover never fires. At --ink-3 with opacity 0.6 it measured
// 1.71:1 against the light surface and 2.09:1 against the dark one — WCAG 1.4.11
// wants 3:1 for a control like this, and it is the trigger for a destructive
// action. Likewise `color: var(--danger)` as TEXT measured 2.04:1 on eatout's
// dark surface against a 4.5:1 requirement.
describe('contrast-critical stylesheet wiring', () => {
    const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
    const ruleFor = (selector) => {
        const at = css.indexOf(`${selector} {`);
        return at === -1 ? null : css.slice(at, css.indexOf('}', at));
    };

    test('the month-delete icon does not rest below 3:1', () => {
        const rule = ruleFor('.month-delete');
        expect(rule).not.toBeNull();
        // --ink-3 at 0.6 opacity was the failing combination.
        expect(rule).not.toContain('var(--ink-3)');
        expect(rule).not.toMatch(/opacity:\s*0\.6\s*;/);
    });

    test('danger text uses a foreground token, not the background one', () => {
        // --danger doubles as a BACKGROUND under white text (.toast.error,
        // .btn-danger), so it cannot simply be lightened for dark mode; the
        // foreground uses need their own scheme-aware token.
        expect(css).toContain('--danger-ink');
        const dark = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
        expect(dark).toContain('--danger-ink:');
        // No remaining foreground use of the raw token.
        expect(css).not.toMatch(/\n\s*color:\s*var\(--danger\)\s*;/);
    });

    test('white-on-danger backgrounds still use the raw token', () => {
        // Lightening those would have made their white text unreadable, which is
        // the whole reason for a separate foreground token.
        expect(ruleFor('.toast.error')).toContain('var(--danger)');
    });
});
