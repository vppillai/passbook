import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';

// Every other frontend test builds its own inline HTML fixture, which is right —
// they are testing behaviour, not the page. The consequence is that index.html
// itself is covered by nothing, and the failure that leaves open is silent: JS
// looks up a hook by id or attribute, the markup no longer carries it, the
// feature quietly does nothing, and every test still passes.
//
// The lock screen rework made that risk concrete. auth.js toggles between an OK
// key and a clear key, renders the biometric button into a reserved slot, and
// announces auto-submit through the dot container's live region — three hooks
// that live only in index.html.
//
// So this file asserts the CONTRACT between index.html and the modules that read
// it. Parsed as a document rather than grepped, so it can check structure
// (parent/sibling relationships) and not merely presence.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const doc = new DOMParser().parseFromString(html, 'text/html');

const authScreen = () => doc.getElementById('auth-screen');
const setupScreen = () => doc.getElementById('setup-screen');

describe('hooks auth.js looks up by id', () => {
    test('both PIN screens and their messages exist', () => {
        for (const id of ['auth-screen', 'setup-screen', 'auth-message', 'setup-message',
            'auth-error', 'setup-error', 'auth-pin-display', 'auth-pin-pad', 'setup-pin-pad']) {
            expect(doc.getElementById(id), `#${id} missing`).not.toBeNull();
        }
    });

    test('the biometric slot exists, so the button never displaces the pad', () => {
        // _injectBiometricButton appends into this. Without it the button is
        // dropped on the floor and biometric unlock becomes unreachable.
        expect(doc.getElementById('biometric-slot')).not.toBeNull();
    });

    test('the slot is a sibling of the pad, not inside it', () => {
        const slot = doc.getElementById('biometric-slot');
        const pad = doc.getElementById('auth-pin-pad');
        expect(slot.parentElement).toBe(pad.parentElement);
        // And it precedes the pad, so filling it pushes nothing downward.
        expect(slot.compareDocumentPosition(pad) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
    });
});

describe('keys prepareAuthScreen toggles', () => {
    test('both pads carry an OK key and a clear key', () => {
        // prepareAuthScreen shows exactly one of these depending on whether the
        // PIN length is known. A missing clear key leaves a hole in the grid; a
        // missing OK key strands anyone whose length is not yet remembered.
        for (const pad of ['auth-pin-pad', 'setup-pin-pad']) {
            const el = doc.getElementById(pad);
            expect(el.querySelector('[data-value="submit"]'), `${pad} has no OK`).not.toBeNull();
            expect(el.querySelector('[data-value="clear"]'), `${pad} has no clear`).not.toBeNull();
        }
    });

    test('the clear key starts hidden, since a fresh device knows no length', () => {
        for (const pad of ['auth-pin-pad', 'setup-pin-pad']) {
            const clear = doc.getElementById(pad).querySelector('[data-value="clear"]');
            expect(clear.classList.contains('hidden')).toBe(true);
        }
    });

    test('the clear key is reachable by assistive tech', () => {
        // Its label is a glyph, so it needs an accessible name of its own.
        for (const pad of ['auth-pin-pad', 'setup-pin-pad']) {
            const clear = doc.getElementById(pad).querySelector('[data-value="clear"]');
            expect(clear.getAttribute('aria-label')).toBeTruthy();
        }
    });

    test('every pad still has ten digits and a backspace', () => {
        for (const pad of ['auth-pin-pad', 'setup-pin-pad']) {
            const el = doc.getElementById(pad);
            const digits = [...el.querySelectorAll('.pin-key')]
                .map(k => k.getAttribute('data-value'))
                .filter(v => /^[0-9]$/.test(v));
            expect(new Set(digits).size, `${pad} digit count`).toBe(10);
            expect(el.querySelector('[data-value="back"]')).not.toBeNull();
        }
    });
});

describe('structure the layout CSS depends on', () => {
    test('both screens have an identity band', () => {
        for (const screen of [authScreen(), setupScreen()]) {
            expect(screen.querySelector('.pin-identity')).not.toBeNull();
        }
    });

    test('the identity band holds the mark, title, message and dots', () => {
        // .pin-container is a three-band flex column and .pin-identity is the one
        // that takes the slack. If any of these sat outside it the pad would stop
        // being bottom-anchored.
        for (const screen of [authScreen(), setupScreen()]) {
            const band = screen.querySelector('.pin-identity');
            expect(band.querySelector('.pin-mark'), 'mark').not.toBeNull();
            expect(band.querySelector('h1'), 'title').not.toBeNull();
            expect(band.querySelector('p'), 'message').not.toBeNull();
            expect(band.querySelector('.pin-display'), 'dots').not.toBeNull();
        }
    });

    test('the pad is outside the identity band', () => {
        for (const screen of [authScreen(), setupScreen()]) {
            const band = screen.querySelector('.pin-identity');
            expect(band.querySelector('.pin-pad')).toBeNull();
        }
    });

    test('the mark is decorative, not announced', () => {
        // The h1 beside it already names the app, so announcing the mark would
        // just repeat it.
        for (const screen of [authScreen(), setupScreen()]) {
            const mark = screen.querySelector('.pin-mark');
            expect(mark.getAttribute('alt')).toBe('');
            expect(mark.getAttribute('aria-hidden')).toBe('true');
        }
    });
});

describe('accessibility contract', () => {
    test('the auth dot container is a live region', () => {
        // submitAuth writes the verifying state into this container's label,
        // because auto-submit fires without the user pressing anything.
        const display = doc.getElementById('auth-pin-display');
        expect(display.getAttribute('role')).toBe('status');
        expect(display.getAttribute('aria-live')).toBe('polite');
    });

    test('the setup dot container is a live region too', () => {
        const display = setupScreen().querySelector('.pin-display');
        expect(display.getAttribute('role')).toBe('status');
        expect(display.getAttribute('aria-live')).toBe('polite');
    });
});

describe('T9 letters', () => {
    // Removed in v2.10.0 on the reasoning that letters are meaningless for a
    // numeric PIN. That was wrong for this app: people remember a PIN as a word,
    // and the letters are what make the pad read as a familiar phone keypad.
    // Restored, and pinned so they are not "tidied away" a second time.
    test('keys 2-9 each carry their letter group', () => {
        const want = { 2:'ABC', 3:'DEF', 4:'GHI', 5:'JKL',
                       6:'MNO', 7:'PQRS', 8:'TUV', 9:'WXYZ' };
        for (const pad of ['auth-pin-pad', 'setup-pin-pad']) {
            for (const [digit, letters] of Object.entries(want)) {
                const key = doc.getElementById(pad)
                    .querySelector(`[data-value="${digit}"] .key-letters`);
                expect(key, `${pad} key ${digit} has no letters`).not.toBeNull();
                expect(key.textContent.trim()).toBe(letters);
            }
        }
    });

    test('1 and 0 carry none, as on a real keypad', () => {
        for (const pad of ['auth-pin-pad', 'setup-pin-pad']) {
            for (const digit of ['1', '0']) {
                expect(doc.getElementById(pad)
                    .querySelector(`[data-value="${digit}"] .key-letters`)).toBeNull();
            }
        }
    });

    test('16 letter groups across the two pads', () => {
        expect(doc.querySelectorAll('.key-letters').length).toBe(16);
    });
});
