import { test, expect, describe, beforeEach } from 'bun:test';
import { auth, formatCountdown } from '../js/auth.js';

// Minimal slice of index.html: the two PIN screens auth.js drives.
const AUTH_HTML = `
<div id="setup-screen" class="screen hidden">
  <p id="setup-message"></p>
  <div class="pin-display"><span class="pin-dot"></span></div>
  <div class="pin-pad" id="setup-pin-pad"><button class="pin-key" data-value="1"></button></div>
  <p id="setup-error" class="error hidden"></p>
</div>
<div id="auth-screen" class="screen">
  <p id="auth-message">Enter your PIN</p>
  <div class="pin-display" id="auth-pin-display"><span class="pin-dot"></span></div>
  <div class="pin-pad" id="auth-pin-pad">
    <button class="pin-key" data-value="1"></button>
    <button class="pin-key" data-value="2"></button>
    <button class="pin-key pin-key-submit" data-value="submit"></button>
  </div>
  <p id="auth-error" class="error hidden"></p>
</div>`;

describe('formatCountdown', () => {
    test('renders M:SS and rounds up so it never shows 0:00 while locked', () => {
        expect(formatCountdown(65)).toBe('1:05');
        expect(formatCountdown(5)).toBe('0:05');
        expect(formatCountdown(600)).toBe('10:00');
        expect(formatCountdown(0.2)).toBe('0:01');
        expect(formatCountdown(59.9)).toBe('1:00');
    });
});

// The DOM is built and auth.init() called EXACTLY once, before any test.
// auth is a singleton that binds its listeners on first init (guarded by
// `bound`), and its keydown handler attaches to `document`. Rebuilding
// document.body per test would detach the pad listeners from the live nodes
// while leaving the document-level one in place — the tests would then pass
// against a half-wired object. Only mutable auth state is reset per test.
document.body.innerHTML = AUTH_HTML;
auth.init(() => {});

describe('rate-limit lockout', () => {
    beforeEach(() => {
        auth.reset();
        document.getElementById('auth-error').textContent = '';
        document.getElementById('auth-error').classList.add('hidden');
        document.querySelectorAll('#auth-pin-pad .pin-key')
            .forEach(k => { k.disabled = false; });
    });

    const keys = () => Array.from(document.querySelectorAll('#auth-pin-pad .pin-key'));
    const pressKey = (k) => k.dispatchEvent(new window.Event('click', { bubbles: true }));

    test('disables the on-screen pad and shows a countdown', () => {
        auth._startLockout(90);
        expect(keys().every(k => k.disabled)).toBe(true);
        expect(document.getElementById('auth-error').textContent).toContain('1:30');
        auth._clearLockout();
        expect(keys().every(k => !k.disabled)).toBe(true);
    });

    // _startLockout disables the buttons and sets isLoading = false, but the
    // physical-keyboard handler gated only on isLoading — so during a visible
    // "try again in 2:34" countdown the user could still type digits and
    // press Enter, firing a real verify request. The server still refuses it,
    // but the UI says one thing and does another.
    test('ignores physical keyboard input while locked out', () => {
        auth._startLockout(90);

        let submitted = false;
        const realSubmit = auth.submitAuth;
        auth.submitAuth = () => { submitted = true; };
        try {
            for (const key of ['1', '2', '3', '4']) {
                document.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
            }
            document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

            expect(auth.pin).toBe('');
            expect(submitted).toBe(false);
        } finally {
            auth.submitAuth = realSubmit;
            auth._clearLockout();
        }
    });

    test('accepts physical keyboard input again once the lockout clears', () => {
        auth._startLockout(90);
        auth._clearLockout();

        for (const key of ['1', '2', '3']) {
            document.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
        }
        expect(auth.pin).toBe('123');
    });

    // The on-screen pad is disabled during lockout, so a click on it is a
    // no-op at the DOM level; this pins that the delegated handler agrees.
    test('ignores on-screen pad clicks while locked out', () => {
        auth._startLockout(90);
        keys().filter(k => k.dataset.value === '1').forEach(pressKey);
        expect(auth.pin).toBe('');
        auth._clearLockout();
    });
});
