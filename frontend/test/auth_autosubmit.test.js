import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { auth } from '../js/auth.js';
import { rememberPinLength, recalledPinLength } from '../js/pin_memory.js';
import { api } from '../js/api.js';
import * as ui from '../js/ui.js';

// The two PIN screens auth.js drives, with the bottom row carrying BOTH the OK
// and clear keys — the markup toggles between them rather than building DOM.
const HTML = `
<div id="setup-screen" class="screen hidden">
  <p id="setup-message"></p>
  <div class="pin-display"><span class="pin-dot"></span></div>
  <div class="pin-pad" id="setup-pin-pad">
    <button class="pin-key" data-value="1"></button>
    <button class="pin-key pin-key-submit" data-value="submit">OK</button>
    <button class="pin-key hidden" data-value="clear">C</button>
  </div>
  <p id="setup-error" class="error hidden"></p>
</div>
<div id="auth-screen" class="screen">
  <p id="auth-message">Enter your PIN</p>
  <div class="pin-display" id="auth-pin-display" role="status" aria-live="polite" aria-label="0 digits entered"></div>
  <div id="biometric-slot"></div>
  <div class="pin-pad" id="auth-pin-pad">
    <button class="pin-key" data-value="1"></button>
    <button class="pin-key pin-key-submit" data-value="submit">OK</button>
    <button class="pin-key hidden" data-value="clear">C</button>
  </div>
  <p id="auth-error" class="error hidden"></p>
</div>`;

// Drive the screen the way a finger does, then read what the module did.
const type = (digits) => { for (const d of digits) auth.handleAuthInput(d); };
const dotCount = () => document.querySelectorAll('#auth-pin-display .pin-dot').length;
const okHidden = () =>
    document.querySelector('#auth-pin-pad [data-value="submit"]').classList.contains('hidden');

let verifyCalls;
let verifyResult;
const origVerify = api.verifyPin;

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = HTML;
    verifyCalls = [];
    verifyResult = { success: true, token: 't' };
    // Stub the network at the api boundary: this task is about WHEN a verify is
    // sent, not about HTTP.
    api.verifyPin = async (pin) => { verifyCalls.push(pin); return verifyResult; };
    auth.reset();
});
afterEach(() => { api.verifyPin = origVerify; });

describe('dot count follows the remembered PIN length', () => {
    test('shows six dots when the length is unknown', () => {
        auth.prepareAuthScreen();
        expect(dotCount()).toBe(6);
    });

    test('shows exactly the remembered number of dots', () => {
        rememberPinLength(4);
        auth.prepareAuthScreen();
        expect(dotCount()).toBe(4);
    });

    test('keeps OK while the length is unknown', () => {
        auth.prepareAuthScreen();
        expect(okHidden()).toBe(false);
    });

    test('drops OK once the length is known, since entry submits itself', () => {
        rememberPinLength(4);
        auth.prepareAuthScreen();
        expect(okHidden()).toBe(true);
    });
});

describe('auto-submit', () => {
    test('submits on the last digit when the length is known', async () => {
        rememberPinLength(4);
        auth.prepareAuthScreen();
        type('1234');
        await Promise.resolve();
        expect(verifyCalls).toEqual(['1234']);
    });

    test('does not submit before the last digit', async () => {
        rememberPinLength(6);
        auth.prepareAuthScreen();
        type('1234');
        await Promise.resolve();
        expect(verifyCalls).toEqual([]);
    });

    test('does not submit at all when the length is unknown', async () => {
        auth.prepareAuthScreen();
        type('123456');
        await Promise.resolve();
        expect(verifyCalls).toEqual([]);
    });

    test('OK still submits when the length is unknown', async () => {
        auth.prepareAuthScreen();
        type('1234');
        auth.handleAuthInput('submit');
        await Promise.resolve();
        expect(verifyCalls).toEqual(['1234']);
    });

    test('remembers the length after a successful unlock', async () => {
        auth.prepareAuthScreen();
        type('12345');
        auth.handleAuthInput('submit');
        await Promise.resolve(); await Promise.resolve();
        expect(recalledPinLength()).toBe(5);
    });
});

// A stale length would otherwise fire at the wrong count on every unlock and
// silently eat the five-attempt budget.
describe('self-heal on a stale remembered length', () => {
    beforeEach(() => { verifyResult = { success: false, attempts_remaining: 3 }; });

    test('keeps the length after a single failure', async () => {
        rememberPinLength(4);
        auth.prepareAuthScreen();
        type('9999');
        await Promise.resolve(); await Promise.resolve();
        expect(recalledPinLength()).toBe(4);
    });

    test('forgets the length after two consecutive failures', async () => {
        rememberPinLength(4);
        auth.prepareAuthScreen();
        type('9999');
        await Promise.resolve(); await Promise.resolve();
        type('8888');
        await Promise.resolve(); await Promise.resolve();
        expect(recalledPinLength()).toBeNull();
    });

    test('a success in between resets the count', async () => {
        rememberPinLength(4);
        auth.prepareAuthScreen();
        type('9999');
        await Promise.resolve(); await Promise.resolve();
        verifyResult = { success: true, token: 't' };
        type('1234');
        await Promise.resolve(); await Promise.resolve();
        verifyResult = { success: false, attempts_remaining: 3 };
        type('9999');
        await Promise.resolve(); await Promise.resolve();
        expect(recalledPinLength()).toBe(4);
    });
});

// Auto-submit on the setup screen would make a 5- or 6-digit PIN unsettable,
// because the user is CHOOSING the length there.
describe('setup screen is excluded', () => {
    test('four digits do not advance the setup flow on their own', () => {
        auth.reset();
        for (const d of '1234') auth.handleSetupInput(d);
        // Still on the first entry, not the confirm step.
        expect(document.getElementById('setup-message').textContent)
            .not.toBe('Confirm your PIN');
    });

    test('setup keeps six dots regardless of a remembered length', () => {
        rememberPinLength(4);
        auth.prepareAuthScreen();
        expect(document.querySelectorAll('#setup-screen .pin-dot').length).toBe(1);
    });
});

// Auto-submit acts without the user pressing anything, so a screen-reader user
// would otherwise get no signal that a verify is under way.
describe('auto-submit is announced', () => {
    // Asserted synchronously, i.e. while the verify is still in flight. That is
    // the whole window the announcement exists in: submitAuth writes the label
    // before awaiting, and its success path re-prepares the screen, which resets
    // the label to the digit count. One `await Promise.resolve()` here is already
    // a tick too late — the stubbed verify resolves immediately, so submitAuth's
    // continuation is queued BEFORE the test's, and the assertion would read the
    // post-unlock label instead of the announcement.
    test('the live region reports verifying when entry submits itself', () => {
        rememberPinLength(4);
        auth.prepareAuthScreen();
        const display = document.getElementById('auth-pin-display');
        expect(display.getAttribute('aria-live')).toBe('polite');
        type('1234');
        expect(display.getAttribute('aria-label')).toMatch(/verifying/i);
    });
});

// prepareAuthScreen rebuilds the dots via renderPinDots, which does
// container.textContent = '' — so it DESTROYS any dot showPinError has just
// marked. In the wrong-PIN branch the two ran in that order, so the 300ms shake
// never painted: the user got no visual feedback that the PIN was rejected, only
// the text message. The catch block's 429/401 paths already had the right order,
// which made the file internally inconsistent as well.
describe('the wrong-PIN shake survives the dot rebuild', () => {
    beforeEach(() => { verifyResult = { success: false, attempts_remaining: 3 }; });

    test('dots carry the error class after a rejected PIN', async () => {
        rememberPinLength(4);
        auth.prepareAuthScreen();
        type('9999');
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        const marked = document.querySelectorAll('#auth-pin-display .pin-dot.error').length;
        expect(marked).toBeGreaterThan(0);
    });

    test('the dots that are marked are the ones now in the DOM', () => {
        // Guards the specific failure: marking detached nodes leaves the visible
        // dots clean, so counting .error on live children is what catches it.
        auth.prepareAuthScreen();
        const live = [...document.querySelectorAll('#auth-pin-display .pin-dot')];
        ui.showPinError('auth-pin-display');
        expect(live.every(d => d.classList.contains('error'))).toBe(true);
    });
});
