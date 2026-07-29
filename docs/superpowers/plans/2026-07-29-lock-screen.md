# Lock Screen Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the PIN unlock screen submit without an `OK` tap, stop it shifting layout, put the keypad in the thumb zone, and give the keys a surface that survives dark mode.

**Architecture:** A new focused module `frontend/js/pin_memory.js` owns everything this device remembers about unlocking (PIN length, biometric availability, consecutive-failure count), because `api.js` is about HTTP and `auth.js` is about ceremony, and neither should grow a storage concern. `auth.js` consumes it to decide dot count and auto-submit. Layout and key surface are pure CSS on existing shared classes. No API change.

**Tech Stack:** Plain ES modules, no build step. Tests: `bun test` with happy-dom (`frontend/test/`). Styling: hand-written CSS with `color-mix()` derived tokens.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-29-lock-screen-design.md`. Read it before Task 1.
- Branch: `feat/lock-screen`. Already created and holding the spec commit.
- Test-first. Every behaviour step writes a failing test, watches it fail, then implements.
- Run frontend tests from the `frontend/` directory: `cd frontend && bun test`. Running `bun test` from the repo root silently skips `frontend/bunfig.toml`, so happy-dom never loads and ~every DOM test fails for the wrong reason.
- happy-dom has **no layout engine**. Never assert geometry, `offsetParent`, computed size, or visual position. Where the requirement is geometric, assert the stylesheet text instead (precedent: `frontend/test/ui_months.test.js` → `describe('spend bar stylesheet wiring')`).
- Contrast figures must be **measured** with a script and the resulting ratios recorded in a CSS comment. Never assert a ratio you have not computed.
- The test environment resolves the instance to `kids` (`frontend/test/setup.js` sets the URL to `https://example.github.io/passbook/kids/`). Storage-key tests must expect `kids`.
- Never auto-submit on `#setup-screen`. The user is choosing their PIN length there.
- `eslint` must stay clean: `cd frontend && bun run lint`.
- Do not touch the backend, the auth API contract, rate limiting, or Argon2 parameters.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `frontend/js/pin_memory.js` | Per-instance memory of PIN length, biometric availability, consecutive failures. Pure storage + validation, no DOM. | **create** |
| `frontend/js/api.js` | Expose `instanceName()` so `pin_memory` scopes its keys from the same source as `SESSION_KEY`, rather than re-deriving. | modify |
| `frontend/js/ui.js` | `renderPinDots(containerId, count)` — build N dots. `updatePinDisplay` keeps filling whatever dots exist. | modify |
| `frontend/js/auth.js` | Consume `pin_memory`: dot count, auto-submit, self-heal, `OK`↔`clear` toggle, biometric slot. | modify |
| `frontend/index.html` | Identity mark, `#biometric-slot`, `clear` key beside `OK` on both PIN screens. | modify |
| `frontend/css/styles.css` | Thumb-first `.pin-container`, fluid `.pin-key`, tinted-wash face, `--focus-ring`, short-viewport rule. | modify |
| `frontend/test/pin_memory.test.js` | Storage, validation, instance scoping, failure counting. | **create** |
| `frontend/test/auth_autosubmit.test.js` | Auto-submit, self-heal, setup exclusion, `OK`↔`clear`. | **create** |
| `frontend/test/auth_biometric_slot.test.js` | Slot reserved from cache, no shift, first-load behaviour. | **create** |
| `frontend/test/ui_lockscreen_css.test.js` | Stylesheet wiring for layout, key surface, focus ring. | **create** |

---

### Task 1: `pin_memory.js` — what this device remembers

**Files:**
- Create: `frontend/js/pin_memory.js`
- Create: `frontend/test/pin_memory.test.js`
- Modify: `frontend/js/api.js` (add one export near `isOwnApiCacheName`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, all consumed by Tasks 2 and 4:
  - `instanceName(): string` — exported from `frontend/js/api.js`
  - `rememberPinLength(n: number): void`
  - `recalledPinLength(): number | null`
  - `forgetPinLength(): void`
  - `noteFailedAttempt(): number` — returns the new consecutive count
  - `clearFailedAttempts(): void`
  - `rememberBiometricAvailable(v: boolean): void`
  - `recalledBiometricAvailable(): boolean | null`

- [ ] **Step 1: Write the failing test**

Create `frontend/test/pin_memory.test.js`:

```js
import { test, expect, describe, beforeEach } from 'bun:test';
import {
    rememberPinLength, recalledPinLength, forgetPinLength,
    noteFailedAttempt, clearFailedAttempts,
    rememberBiometricAvailable, recalledBiometricAvailable,
} from '../js/pin_memory.js';

// The unlock screen cannot auto-submit without knowing how long the PIN is, and
// /api/auth/status deliberately does not say (it is unauthenticated, so telling
// it would hand an attacker the exact keyspace). The device therefore learns the
// length from the user's own successful entry.
//
// Everything here is per-instance: kids and eatout share an origin, so a key
// without the instance in it would leak one app's state into the other — the
// same defect class as the logout cache purge fixed in v2.8.0.
describe('pin length memory', () => {
    beforeEach(() => localStorage.clear());

    test('remembers and recalls a length', () => {
        rememberPinLength(4);
        expect(recalledPinLength()).toBe(4);
    });

    test('recalls nothing before anything is stored', () => {
        expect(recalledPinLength()).toBeNull();
    });

    test('forgetting restores the unknown state', () => {
        rememberPinLength(6);
        forgetPinLength();
        expect(recalledPinLength()).toBeNull();
    });

    test('scopes the key to this instance', () => {
        rememberPinLength(5);
        expect(localStorage.getItem('passbook_pin_length_kids')).toBe('5');
    });

    test('ignores a length outside 4-6', () => {
        // Storage is user-writable. A bad value must read as unknown rather than
        // driving auto-submit at a count no PIN can have.
        for (const bad of ['0', '3', '7', '99', '-4', '4.5', 'abc', '']) {
            localStorage.setItem('passbook_pin_length_kids', bad);
            expect(recalledPinLength()).toBeNull();
        }
    });

    test('refuses to remember a length outside 4-6', () => {
        rememberPinLength(9);
        expect(recalledPinLength()).toBeNull();
    });
});

// A remembered length goes stale when the PIN is changed on another device.
// Auto-submit would then fire at the wrong count on EVERY unlock and silently
// consume the 5-attempt budget, so failures are counted and the memory is
// dropped before that can happen.
describe('consecutive failure counting', () => {
    beforeEach(() => localStorage.clear());

    test('counts up across calls', () => {
        expect(noteFailedAttempt()).toBe(1);
        expect(noteFailedAttempt()).toBe(2);
        expect(noteFailedAttempt()).toBe(3);
    });

    test('clearing resets the count', () => {
        noteFailedAttempt();
        clearFailedAttempts();
        expect(noteFailedAttempt()).toBe(1);
    });

    test('scopes the counter to this instance', () => {
        noteFailedAttempt();
        expect(localStorage.getItem('passbook_pin_fails_kids')).toBe('1');
    });

    test('a corrupt counter starts over rather than throwing', () => {
        localStorage.setItem('passbook_pin_fails_kids', 'not-a-number');
        expect(noteFailedAttempt()).toBe(1);
    });
});

// The biometric button is injected only after two network calls resolve, which
// shoves the keypad down just as the user goes to tap it. Caching the answer
// lets a returning user render the slot on first paint.
describe('biometric availability memory', () => {
    beforeEach(() => localStorage.clear());

    test('recalls nothing on a first-ever load', () => {
        // Correct to reserve nothing: enrolment requires a prior successful
        // login, so a device that has never logged in cannot be enrolled.
        expect(recalledBiometricAvailable()).toBeNull();
    });

    test('remembers true and false distinctly from unknown', () => {
        rememberBiometricAvailable(true);
        expect(recalledBiometricAvailable()).toBe(true);
        rememberBiometricAvailable(false);
        expect(recalledBiometricAvailable()).toBe(false);
    });

    test('scopes the key to this instance', () => {
        rememberBiometricAvailable(true);
        expect(localStorage.getItem('passbook_biometric_kids')).toBe('1');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && bun test test/pin_memory.test.js`
Expected: FAIL — `Export named 'rememberPinLength' not found in module '.../js/pin_memory.js'` (the module does not exist yet).

- [ ] **Step 3: Export `instanceName` from `api.js`**

In `frontend/js/api.js`, immediately above the existing `isOwnApiCacheName` JSDoc block, add:

```js
/**
 * The instance this page belongs to ("kids", "eatout", or "default" when served
 * from the root). Exported so other modules can scope their own storage keys to
 * the same value SESSION_KEY uses, instead of re-deriving it — a second copy of
 * the derivation is exactly how the logout cache purge came to span instances.
 * @returns {string}
 */
export function instanceName() {
    return INSTANCE;
}
```

- [ ] **Step 4: Write minimal implementation**

Create `frontend/js/pin_memory.js`:

```js
/**
 * Per-instance memory of what this device knows about unlocking: how long the
 * PIN is, whether biometrics are enrolled, and how many times entry has failed
 * in a row.
 *
 * Separate from api.js (which is about HTTP) and auth.js (which is about the
 * unlock ceremony) so the storage rules — key scoping and validation — live in
 * one small, directly testable place.
 *
 * Keys are scoped with api.js's instanceName(). kids and eatout share an origin,
 * so an unscoped key would let one app read the other's state.
 *
 * @module pin_memory
 */

import { instanceName } from './api.js';

const MIN_PIN = 4;
const MAX_PIN = 6;

const lengthKey = () => `passbook_pin_length_${instanceName()}`;
const failsKey = () => `passbook_pin_fails_${instanceName()}`;
const bioKey = () => `passbook_biometric_${instanceName()}`;

// localStorage throws in private-mode Safari and when a quota is exhausted.
// Every accessor degrades to "we know nothing", which is the safe state: the
// screen falls back to six dots and an OK key, i.e. today's behaviour.
function read(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function write(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch { /* nothing to do; the feature degrades, the login still works */ }
}

function drop(key) {
    try {
        localStorage.removeItem(key);
    } catch { /* as above */ }
}

/**
 * Stores the PIN's length. Silently ignores anything outside 4-6, so a caller
 * bug cannot install a length no PIN can have.
 * @param {number} n
 */
export function rememberPinLength(n) {
    if (!Number.isInteger(n) || n < MIN_PIN || n > MAX_PIN) return;
    write(lengthKey(), String(n));
}

/**
 * The remembered PIN length, or null when unknown.
 *
 * Validated on the way out as well as in: storage is user-writable, and a
 * tampered value must read as unknown rather than making auto-submit fire at a
 * count no PIN can have — which would spend a real login attempt every time.
 * @returns {number|null}
 */
export function recalledPinLength() {
    const raw = read(lengthKey());
    if (raw === null) return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < MIN_PIN || n > MAX_PIN) return null;
    return n;
}

/** Drops the remembered length, returning the screen to its OK-key fallback. */
export function forgetPinLength() {
    drop(lengthKey());
}

/**
 * Records one failed unlock and returns the new consecutive count. A corrupt
 * stored value restarts the count rather than propagating NaN.
 * @returns {number}
 */
export function noteFailedAttempt() {
    const prev = Number(read(failsKey()));
    const next = Number.isInteger(prev) && prev > 0 ? prev + 1 : 1;
    write(failsKey(), String(next));
    return next;
}

/** Clears the consecutive-failure count, called on any successful unlock. */
export function clearFailedAttempts() {
    drop(failsKey());
}

/**
 * Caches whether a platform authenticator is enrolled and usable, so a
 * returning user's biometric slot can be rendered on first paint instead of
 * after two network round trips.
 * @param {boolean} v
 */
export function rememberBiometricAvailable(v) {
    write(bioKey(), v ? '1' : '0');
}

/**
 * The cached biometric answer, or null when this device has never checked.
 * Null is deliberately distinct from false: it means "reserve nothing yet".
 * @returns {boolean|null}
 */
export function recalledBiometricAvailable() {
    const raw = read(bioKey());
    if (raw === null) return null;
    return raw === '1';
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && bun test test/pin_memory.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 6: Run the whole suite and lint**

Run: `cd frontend && bun test && bun run lint`
Expected: all existing tests still pass; eslint silent.

- [ ] **Step 7: Commit**

```bash
git add frontend/js/pin_memory.js frontend/js/api.js frontend/test/pin_memory.test.js
git commit -m "feat(auth): per-instance memory of PIN length and biometric availability

The unlock screen cannot auto-submit without knowing the PIN's length, and
/api/auth/status deliberately will not say: it is unauthenticated, so
exposing pin_length would tell an attacker the keyspace is exactly 10,000
rather than 10,000 + 100,000 + 1,000,000. The device therefore learns the
length from the user's own successful entry.

Its own module rather than a few fields in api.js or auth.js: api.js is
about HTTP and auth.js about the unlock ceremony, and the storage rules
(instance scoping, validation both ways) are worth having in one small
testable place.

Keys are scoped via a new instanceName() export from api.js rather than a
second copy of detectInstance(). A duplicated derivation is exactly how the
logout cache purge came to span instances.

Values are validated on READ as well as write, because storage is
user-writable: a tampered length must read as unknown rather than making
auto-submit fire at a count no PIN can have, which would spend a real login
attempt on every unlock. Every accessor also tolerates localStorage
throwing (private-mode Safari, exhausted quota) by degrading to \"we know
nothing\", which is the state that falls back to today's behaviour."
```

---

### Task 2: Dots at the remembered length, and auto-submit

**Files:**
- Modify: `frontend/js/ui.js` (add `renderPinDots`)
- Modify: `frontend/js/auth.js`
- Create: `frontend/test/auth_autosubmit.test.js`

**Interfaces:**
- Consumes: everything Task 1 produced.
- Produces, relied on by Task 3:
  - `ui.renderPinDots(containerId: string, count: number): void`
  - `auth.pinLength: number | null` — the active length, null when unknown

- [ ] **Step 1: Write the failing test**

Create `frontend/test/auth_autosubmit.test.js`:

```js
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { auth } from '../js/auth.js';
import { rememberPinLength, recalledPinLength } from '../js/pin_memory.js';
import { api } from '../js/api.js';

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
  <div class="pin-display" id="auth-pin-display"></div>
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && bun test test/auth_autosubmit.test.js`
Expected: FAIL — `auth.prepareAuthScreen is not a function`.

- [ ] **Step 3: Add `renderPinDots` to `ui.js`**

In `frontend/js/ui.js`, directly above the existing `export function updatePinDisplay`, add:

```js
/**
 * Renders exactly `count` empty PIN dots into a display, replacing whatever was
 * there.
 *
 * The dot count used to be six in the markup regardless of the real PIN length,
 * so a 4-digit PIN left two dots that could never fill and nothing indicated how
 * many digits were expected. Building them lets the count follow the length the
 * device has learned.
 *
 * @param {string} containerId - screen id or display id (same resolution as updatePinDisplay)
 * @param {number} count
 */
export function renderPinDots(containerId, count) {
    const container = document.querySelector(`#${containerId} .pin-display`) ||
                      document.querySelector(`#${containerId}`);
    if (!container) return;
    container.textContent = '';
    for (let i = 0; i < count; i++) {
        const dot = document.createElement('span');
        dot.className = 'pin-dot';
        container.appendChild(dot);
    }
    container.setAttribute('aria-label', '0 digits entered');
}
```

- [ ] **Step 4: Wire `auth.js`**

In `frontend/js/auth.js`, add to the imports at the top:

```js
import {
    rememberPinLength, recalledPinLength, forgetPinLength,
    noteFailedAttempt, clearFailedAttempts,
} from './pin_memory.js';
```

In the `constructor`, after `this.pendingDelete`-style fields (i.e. at the end of the existing field list), add:

```js
        /** @type {number|null} PIN length this device has learned; null = unknown.
         *  When known the screen renders exactly that many dots and submits on
         *  the last digit; when unknown it falls back to six dots and OK. */
        this.pinLength = null;
        /** Consecutive failures needed before a remembered length is dropped.
         *  Two, not one: a single wrong PIN of the right length is an ordinary
         *  fumble, but two in a row is the signature of a length that has gone
         *  stale (PIN changed on another device). */
        this.staleLengthThreshold = 2;
```

Add this method to the class, directly above `handleAuthInput`:

```js
    /**
     * Prepares the unlock screen for entry: reads the remembered PIN length,
     * renders that many dots, and shows OK only when the length is unknown.
     *
     * Called on init and after every attempt, so a self-heal that drops the
     * remembered length immediately restores the OK key.
     */
    prepareAuthScreen() {
        this.pinLength = recalledPinLength();
        this.pin = '';
        ui.renderPinDots('auth-pin-display', this.pinLength || 6);

        // Both keys are in the markup; toggling avoids building DOM and keeps
        // the 3-column grid full either way.
        const pad = document.getElementById('auth-pin-pad');
        if (!pad) return;
        const ok = pad.querySelector('[data-value="submit"]');
        const clear = pad.querySelector('[data-value="clear"]');
        const known = this.pinLength !== null;
        if (ok) ok.classList.toggle('hidden', known);
        if (clear) clear.classList.toggle('hidden', !known);
    }
```

In `handleAuthInput`, replace the digit-adding block at the end:

```js
        // Add digit
        if (this.pin.length < 6) {
            this.pin += value;
            ui.updatePinDisplay('auth-pin-display', this.pin.length);
        }
    }
```

with:

```js
        if (value === 'clear') {
            this.pin = '';
            ui.updatePinDisplay('auth-pin-display', 0);
            return;
        }

        // Add digit. The cap is the known length when we have one, else 6.
        const cap = this.pinLength || 6;
        if (this.pin.length < cap) {
            this.pin += value;
            ui.updatePinDisplay('auth-pin-display', this.pin.length);
        }

        // Auto-submit: the whole point of remembering the length. Only fires
        // when the length is KNOWN, so an unknown-length device never submits a
        // guess the user did not confirm.
        if (this.pinLength !== null && this.pin.length === this.pinLength) {
            this.submitAuth();
        }
    }
```

In `submitAuth`, inside `if (result.success) {`, immediately after `this._clearLockout();`, add:

```js
                // The entry was correct, so its length is authoritative.
                rememberPinLength(this.pin.length);
                clearFailedAttempts();
```

and in the same method's `else` branch (wrong PIN), immediately after `ui.showPinError('auth-pin-display');`, add:

```js
                // Drop a remembered length that has gone stale, so the screen
                // stops auto-submitting at a count that can never succeed.
                if (this.pinLength !== null &&
                    noteFailedAttempt() >= this.staleLengthThreshold) {
                    forgetPinLength();
                }
```

Then, at the end of both the success and failure branches and the `catch`, the screen must be re-prepared so a dropped length takes effect. Replace each of the three existing `ui.updatePinDisplay('auth-pin-display', 0);` calls inside `submitAuth` with:

```js
                this.prepareAuthScreen();
```

Finally, in `init()`, after the existing `this.refreshBiometricButton();` call, add:

```js
        this.prepareAuthScreen();
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && bun test test/auth_autosubmit.test.js`
Expected: PASS.

- [ ] **Step 6: Run the whole suite and lint**

Run: `cd frontend && bun test && bun run lint`
Expected: all pass. If `test/auth_lockout.test.js` fails, its fixture lacks the `clear` key — add `<button class="pin-key hidden" data-value="clear">C</button>` to its `#auth-pin-pad`, and note in the commit that the fixture was extended.

- [ ] **Step 7: Commit**

```bash
git add frontend/js/auth.js frontend/js/ui.js frontend/test/
git commit -m "feat(auth): auto-submit the PIN once the device knows its length

Every unlock used to cost an extra deliberate tap: enter the digits, then
find OK. That was not an oversight — the PIN is 4-6 digits and the client
had no way to know which — but with the length remembered per device it is
avoidable, and it is paid several times a day.

Dots now render at the remembered length instead of always six, so the
screen also stops showing two dots a 4-digit PIN can never fill. OK is
hidden once the length is known, since entry submits itself, and a clear
key takes its cell so the 3-column grid stays full. Both keys live in the
markup and are toggled, rather than built.

The self-heal is the load-bearing part. A remembered length goes stale when
the PIN is changed on another device, and auto-submit would then fire at the
wrong count on EVERY unlock, silently consuming the five-attempt budget.
Two consecutive failures at a remembered length drops it and restores OK.
Two rather than one because a single wrong PIN of the right length is an
ordinary fumble; two in a row is the signature of a stale length.

The setup screen is untouched: handleSetupInput has its own gating, so
auto-submit cannot reach it by construction, and a test pins that. Auto-
submitting there would make a 5- or 6-digit PIN unsettable, since the user
is choosing the length."
```

---

### Task 3: Biometric slot that does not shift the layout

**Files:**
- Modify: `frontend/index.html` (add `#biometric-slot` to `#auth-screen`)
- Modify: `frontend/js/auth.js` (`_injectBiometricButton`, `_removeBiometricButton`, `refreshBiometricButton`)
- Create: `frontend/test/auth_biometric_slot.test.js`

**Interfaces:**
- Consumes: `rememberBiometricAvailable`, `recalledBiometricAvailable` from Task 1; `auth.prepareAuthScreen` from Task 2.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Create `frontend/test/auth_biometric_slot.test.js`:

```js
import { test, expect, describe, beforeEach } from 'bun:test';
import { auth } from '../js/auth.js';
import { rememberBiometricAvailable } from '../js/pin_memory.js';

const HTML = `
<div id="auth-screen" class="screen">
  <p id="auth-message"></p>
  <div class="pin-display" id="auth-pin-display"></div>
  <div id="biometric-slot"></div>
  <div class="pin-pad" id="auth-pin-pad">
    <button class="pin-key pin-key-submit" data-value="submit">OK</button>
    <button class="pin-key hidden" data-value="clear">C</button>
  </div>
  <p id="auth-error" class="error hidden"></p>
</div>`;

const slot = () => document.getElementById('biometric-slot');
const btn = () => document.getElementById('webauthn-login-btn');

describe('biometric slot', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = HTML;
    });

    test('the slot exists in the markup, before any network call', () => {
        // The button used to be inserted BEFORE the pad once two async checks
        // resolved, so the pad painted and was then shoved down. A slot that is
        // always present is what removes the shift.
        expect(slot()).not.toBeNull();
    });

    test('renders the button into the slot, not before the pad', () => {
        auth._injectBiometricButton();
        expect(btn()).not.toBeNull();
        expect(slot().contains(btn())).toBe(true);
    });

    test('is marked filled when a button is present, so CSS can reserve height', () => {
        auth._injectBiometricButton();
        expect(slot().classList.contains('filled')).toBe(true);
    });

    test('injecting twice does not duplicate the button', () => {
        auth._injectBiometricButton();
        auth._injectBiometricButton();
        expect(slot().querySelectorAll('#webauthn-login-btn').length).toBe(1);
    });

    test('removing clears both the button and the filled marker', () => {
        auth._injectBiometricButton();
        auth._removeBiometricButton();
        expect(btn()).toBeNull();
        expect(slot().classList.contains('filled')).toBe(false);
    });

    test('a returning enrolled device fills the slot before the network answers', () => {
        rememberBiometricAvailable(true);
        auth.primeBiometricSlot();
        expect(btn()).not.toBeNull();
    });

    test('a device cached as not enrolled reserves nothing', () => {
        rememberBiometricAvailable(false);
        auth.primeBiometricSlot();
        expect(btn()).toBeNull();
    });

    test('a first-ever load reserves nothing', () => {
        // Always right: enrolment requires a prior successful login, so a device
        // that has never logged in cannot be enrolled.
        auth.primeBiometricSlot();
        expect(btn()).toBeNull();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && bun test test/auth_biometric_slot.test.js`
Expected: FAIL — `auth.primeBiometricSlot is not a function`, and the injection test fails because the current code targets `pad.parentNode`.

- [ ] **Step 3: Add the slot to the markup**

In `frontend/index.html`, inside `#auth-screen`, between the closing `</div>` of `#auth-pin-display` and the opening `<div class="pin-pad" id="auth-pin-pad">`, insert:

```html
            <!-- Reserved slot for the biometric button. Always present so that
                 filling it later cannot shove the keypad down; CSS gives it a
                 height only when .filled is set. -->
            <div id="biometric-slot"></div>
```

- [ ] **Step 4: Rework the three methods in `auth.js`**

Add to the `pin_memory.js` import list in `frontend/js/auth.js`:

```js
    rememberBiometricAvailable, recalledBiometricAvailable,
```

Replace `_injectBiometricButton` and `_removeBiometricButton` entirely with:

```js
    /** Renders the biometric button into the reserved slot (idempotent). */
    _injectBiometricButton() {
        const slot = document.getElementById('biometric-slot');
        if (!slot || document.getElementById('webauthn-login-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'webauthn-login-btn';
        btn.type = 'button';
        btn.className = 'btn-biometric';
        btn.textContent = labels.auth_use_biometrics || 'Use biometrics';
        btn.addEventListener('click', () => this.loginWithBiometrics());
        slot.appendChild(btn);
        // CSS keys the slot's height off .filled, so an empty slot costs nothing.
        slot.classList.add('filled');
    }

    /** Empties the reserved slot. */
    _removeBiometricButton() {
        const btn = document.getElementById('webauthn-login-btn');
        if (btn) btn.remove();
        const slot = document.getElementById('biometric-slot');
        if (slot) slot.classList.remove('filled');
    }

    /**
     * Fills the biometric slot from the cached answer, synchronously, before any
     * network call.
     *
     * refreshBiometricButton has to await getAuthStatus() and
     * isPlatformAuthenticatorAvailable(), so it can only ever act after the pad
     * has painted — which is what produced the shift. A returning enrolled user
     * gets the slot on first paint from here; the real check then confirms or
     * corrects it.
     *
     * An unknown cache reserves nothing, which is always right: enrolment needs
     * a prior successful login, so a device that has never logged in cannot be
     * enrolled.
     */
    primeBiometricSlot() {
        if (recalledBiometricAvailable() === true) this._injectBiometricButton();
    }
```

In `refreshBiometricButton`, record the answer. Replace its `if (status && status.webauthn_enrolled && available) { … } else { … }` block with:

```js
            const enrolled = !!(status && status.webauthn_enrolled) && available;
            rememberBiometricAvailable(enrolled);
            if (enrolled) {
                this._injectBiometricButton();
            } else {
                this._removeBiometricButton();
            }
```

In `init()`, call the primer before the async refresh — so the ordering reads as "paint from cache, then verify":

```js
        this.primeBiometricSlot();
        this.refreshBiometricButton();
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && bun test test/auth_biometric_slot.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 6: Run the whole suite and lint**

Run: `cd frontend && bun test && bun run lint`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/index.html frontend/js/auth.js frontend/test/auth_biometric_slot.test.js
git commit -m "fix(auth): stop the biometric button shifting the keypad

The button was inserted before the pad only after getAuthStatus() and
isPlatformAuthenticatorAvailable() both resolved, so the pad painted first
and was then shoved down — right where the user was about to tap. It was
also styled btn btn-outline btn-full, chosen because it needed no new CSS,
so the fastest way in looked like the secondary one.

There is now a #biometric-slot always present in the markup, and the button
renders into it. CSS keys the slot's height off a .filled class, so an
empty slot costs no space.

That alone would still shift on the first paint of every load, so the
availability answer is cached per instance and primeBiometricSlot() fills
the slot synchronously before any network call. The real check then
confirms or corrects it. An unknown cache reserves nothing, which is always
correct: enrolment requires a prior successful login, so a device that has
never logged in cannot be enrolled."
```

---

### Task 4: Thumb-first layout

**Files:**
- Modify: `frontend/css/styles.css` — `.pin-container` (from line ~224), `.pin-display`, `.pin-pad`, `.pin-key`
- Create: `frontend/test/ui_lockscreen_css.test.js`

**Interfaces:**
- Consumes: `#biometric-slot` from Task 3.
- Produces: `.pin-identity` class, consumed by Task 6's mark.

- [ ] **Step 1: Write the failing test**

Create `frontend/test/ui_lockscreen_css.test.js`:

```js
import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';

// happy-dom has no layout engine, so none of this can be asserted by rendering —
// that blind spot is how the offsetParent focus-trap bug reached production
// earlier. These assert the stylesheet text instead, the same way
// ui_months.test.js pins the spend-bar tokens.
const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
const ruleFor = (selector) => {
    const at = css.indexOf(`${selector} {`);
    return at === -1 ? null : css.slice(at, css.indexOf('}', at));
};

describe('lock screen layout', () => {
    test('the pad is no longer centred mid-screen', () => {
        // justify-content:center put the keys in the middle of a tall phone,
        // above the natural thumb arc.
        expect(ruleFor('.pin-container')).not.toContain('justify-content: center');
    });

    test('keys are fluid, not a fixed 72px', () => {
        // 3x72 + 2x14 = 244px inside a 280px pad, so the declared gaps were not
        // the real ones and the pad never grew on a larger phone.
        const rule = ruleFor('.pin-key');
        expect(rule).not.toMatch(/width:\s*72px/);
        expect(rule).toContain('aspect-ratio: 1');
    });

    test('the pad may grow past its old 280px cap', () => {
        const rule = ruleFor('.pin-pad');
        expect(rule).not.toMatch(/max-width:\s*280px/);
    });

    test('an empty biometric slot costs no height', () => {
        const empty = ruleFor('#biometric-slot');
        expect(empty).not.toBeNull();
        expect(ruleFor('#biometric-slot.filled')).not.toBeNull();
    });

    test('a short viewport has a rule to fall back to', () => {
        // The only media queries were min-width:768px, prefers-color-scheme and
        // prefers-reduced-motion, so landscape had nothing at all.
        expect(css).toMatch(/@media\s*\([^)]*max-height:/);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && bun test test/ui_lockscreen_css.test.js`
Expected: FAIL on all five.

- [ ] **Step 3: Rewrite the layout rules**

In `frontend/css/styles.css`, replace everything from the start of the
`.pin-container` rule (currently ~line 224) through the closing brace of the
`.pin-pad` rule (~line 295) with the block below. That span also contains
`.pin-container h1`, `.pin-container p`, `.pin-hint`, `.pin-dot`, `.pin-dot.filled`,
`.pin-dot.error` and `@keyframes shake` — all of them are reproduced below, some
unchanged, so the block is a complete replacement rather than a partial one.

```css
/* Thumb-first lock screen.
   Three bands: identity (grows), the reserved biometric slot, then the pad
   pinned to the bottom so the keys land in the natural thumb arc. .screen
   already supplies env(safe-area-inset-bottom), so the pad clears the home
   indicator without extra handling here.
   Previously this was justify-content:center, which parked the keypad in the
   middle of a tall phone. */
.pin-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    max-width: 380px;
    margin: 0 auto;
    padding: var(--spacing);
}

/* Carried through unchanged from before the rework — listed here because the
   replacement range spans them, and the short-viewport rule below targets the
   first two. Dropping them would leave the title and message unstyled. */
.pin-container h1 {
    font-family: var(--font-display);
    font-weight: 640;
    font-size: 1.9rem;
    letter-spacing: -0.02em;
    margin-bottom: var(--spacing-sm);
    color: var(--ink);
}

.pin-container p {
    color: var(--ink-2);
    margin-bottom: var(--spacing-lg);
    font-size: 0.95rem;
}

.pin-hint {
    font-size: 0.75rem;
    color: var(--ink-3);
    margin-top: var(--spacing);
}

/* Identity band: mark, title, sub-message, dots. Takes the slack so the pad
   stays at the bottom whatever the viewport height. */
.pin-identity {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    width: 100%;
}

.pin-mark {
    width: 56px;
    height: 56px;
    margin-bottom: var(--spacing);
    border-radius: var(--r-md);
}

.pin-display {
    display: flex;
    gap: 14px;
    margin-top: var(--spacing-lg);
}

.pin-dot {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    border: 2px solid var(--ink-3);
    background: transparent;
    transition: var(--transition);
}

.pin-dot.filled {
    background: var(--accent);
    border-color: var(--accent);
    transform: scale(1.12);
}

.pin-dot.error {
    border-color: var(--danger);
    background: var(--danger);
    animation: shake 0.3s ease;
}

@keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-4px); }
    75% { transform: translateX(4px); }
}

/* The slot is always in the DOM so filling it cannot move the pad. Empty it
   costs nothing; .filled gives it its height and spacing. */
#biometric-slot {
    width: 100%;
}

#biometric-slot.filled {
    margin-bottom: var(--spacing);
}

/* Pad fills the container width with square keys, so the declared gap is the
   real gap. Was a 280px cap with fixed 72px keys, which left 36px of slack
   distributed into the columns and never grew on a larger phone. */
.pin-pad {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
    width: 100%;
    max-width: 360px;
}
```

Then replace the `.pin-key` rule's sizing lines — change:

```css
.pin-key {
    width: 72px;
    height: 72px;
```

to:

```css
.pin-key {
    aspect-ratio: 1;
```

Finally append, next to the other media queries near the end of the file:

```css
/* Short viewport (landscape phone, split view). The identity band is the only
   compressible part, so the mark goes and the rhythm tightens; the pad keeps its
   size because it is what the user is aiming at. Nothing existed here before, so
   landscape simply overflowed. */
@media (max-height: 620px) {
    .pin-mark {
        display: none;
    }

    .pin-container h1 {
        font-size: 1.35rem;
        margin-bottom: 2px;
    }

    .pin-container p {
        margin-bottom: var(--spacing-sm);
    }

    .pin-display {
        margin-top: var(--spacing);
    }

    .pin-pad {
        gap: 10px;
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && bun test test/ui_lockscreen_css.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wrap the identity band in the markup**

In `frontend/index.html`, in **both** `#auth-screen` and `#setup-screen`, wrap the `<h1>`, the message `<p>`, and the `.pin-display` in `<div class="pin-identity"> … </div>`. The `#biometric-slot` and `.pin-pad` stay outside it, as siblings.

- [ ] **Step 6: Run the whole suite and lint**

Run: `cd frontend && bun test && bun run lint`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/css/styles.css frontend/index.html frontend/test/ui_lockscreen_css.test.js
git commit -m "feat(ui): anchor the PIN pad in the thumb zone

.pin-container was justify-content:center, which parked the keypad in the
middle of a tall phone, above where the thumb naturally reaches. It is now
three bands — identity (takes the slack), the reserved biometric slot, then
the pad pinned to the bottom. .screen already supplies
env(safe-area-inset-bottom), so nothing extra is needed to clear the home
indicator.

The pad also did not fit its own grid: 3x72px keys plus 2x14px gaps is
244px inside a 280px pad, so 36px of slack was distributed into the 1fr
columns and the real gaps were wider than the declared ones. Keys are now
aspect-ratio:1 with no fixed width, so the grid is honoured exactly, and
the cap rises from 280px to 360px so the pad grows on a larger phone
instead of staying the same size on a 320px and a 430px handset.

Adds the first short-viewport rule in the stylesheet. The only media
queries were min-width:768px, prefers-color-scheme and
prefers-reduced-motion, so a landscape phone had no fallback at all; the
identity band now compresses and the pad keeps its size, since it is what
the user is aiming at.

Asserted against the stylesheet text rather than by rendering, because
happy-dom has no layout engine — the blind spot that let the offsetParent
focus-trap bug through earlier."
```

---

### Task 5: Tinted-wash keys and a focus ring that measures up

**Files:**
- Modify: `frontend/css/styles.css` — `:root` tokens, dark block, `.pin-key`, `:focus-visible`
- Modify: `frontend/index.html` — remove `.key-letters` spans
- Modify: `frontend/test/ui_lockscreen_css.test.js` — add a describe block

**Interfaces:**
- Consumes: `.pin-key` from Task 4.
- Produces: `--key-face`, `--key-face-pressed`, `--focus-ring` tokens.

- [ ] **Step 1: Measure, before writing any value**

Create `/tmp/keys.mjs` and run it with `bun /tmp/keys.mjs`. Record the output; the numbers go into the CSS comment in Step 4.

```js
const hex=h=>{h=h.replace('#','');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255)};
const mix=(a,p,b)=>a.map((v,i)=>v*p+b[i]*(1-p));
const over=(fg,a,bg)=>fg.map((v,i)=>v*a+bg[i]*(1-a));
const lum=c=>{const f=v=>(v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4);const[r,g,b]=c.map(f);return .2126*r+.7152*g+.0722*b};
const R=(x,y)=>{const[a,b]=[lum(x),lum(y)].sort((m,n)=>n-m);return (a+.05)/(b+.05)};
const INST=[{n:'kids  ',accent:'#5B7FD9',bg:'#F5F7FB'},{n:'eatout',accent:'#E07856',bg:'#FFF8F4'}];
for (const s of ['light','dark']) for (const i of INST) {
  const bg = s==='light'?hex(i.bg):mix(hex(i.accent),0.04,hex('#0c0e12'));
  const ink = s==='light'?hex('#191c20'):hex('#e9ebee');
  const face = over(hex(i.accent), s==='light'?0.16:0.20, bg);
  // Focus ring: deepen toward black on light, lift toward white on dark.
  const ring = s==='light' ? mix(hex(i.accent),0.75,[0,0,0]) : mix(hex(i.accent),0.70,[1,1,1]);
  console.log(`${s.padEnd(5)} ${i.n} numeral-on-face ${R(ink,face).toFixed(2)}  `+
              `key-vs-page ${R(face,bg).toFixed(2)}  focus-ring-vs-page ${R(ring,bg).toFixed(2)}`+
              `${R(ring,bg)>=3?' OK':' *** UNDER 3:1 — raise the mix ***'}`);
}
```

If any focus-ring line reports under 3:1, adjust that mix fraction (deepen on light, lift on dark) and re-run until both instances clear 3:1 in both schemes. Do **not** proceed with a failing ring.

- [ ] **Step 2: Write the failing test**

Append to `frontend/test/ui_lockscreen_css.test.js`:

```js
describe('lock screen key surface', () => {
    test('keys no longer depend on a shadow dark mode erases', () => {
        // In dark mode --surface is color-mix(accent 5%, #14171d) — almost the
        // page background — and the shadow is rgba(0,0,0,...) against near-black,
        // so the keys measured 1.05-1.10:1 against the page.
        const rule = ruleFor('.pin-key');
        expect(rule).not.toContain('box-shadow: var(--shadow)');
        expect(rule).toContain('var(--key-face)');
    });

    test('the key face is derived per instance and re-derived for dark', () => {
        expect(css.split('--key-face:').length - 1).toBe(2);
        const dark = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
        expect(dark).toContain('--key-face:');
    });

    test('the focus ring has its own token, not the raw accent', () => {
        // outline: 2px solid var(--accent) measured ~2.9:1 on eatout. Unlike the
        // key face this one IS required to reach 3:1, and is achievable.
        expect(css).toContain('--focus-ring');
        expect(ruleFor(':focus-visible')).toContain('var(--focus-ring)');
        const dark = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
        expect(dark).toContain('--focus-ring:');
    });

    test('measured ratios are recorded next to the tokens', () => {
        // A future reader must not have to re-derive them.
        const at = css.indexOf('--key-face:');
        expect(css.slice(Math.max(0, at - 1400), at)).toMatch(/Measured/);
    });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd frontend && bun test test/ui_lockscreen_css.test.js`
Expected: FAIL on the four new tests.

- [ ] **Step 4: Add the tokens and apply them**

In `frontend/css/styles.css`, in `:root` immediately after the `--danger-ink` declaration, add — substituting the ratios you measured in Step 1 for `<...>`:

```css
    /* PIN key face. NOT --surface + shadow, which is what this replaces: in dark
       mode --surface is within a hair of the page background and the shadow is
       black-on-near-black, so the keys measured 1.05-1.07:1 (light) and 1.10:1
       (dark) against the page — defined by almost nothing.
       A 3:1 key boundary is unreachable with this palette and was not chased:
       eatout's accent (#E07856) cannot reach 3:1 against its own light
       background at ANY alpha, and a neutral face that does reach it needs ink
       at 48%, giving #8b8e92 keys that read as disabled while dropping numeral
       contrast from ~13:1 to ~5:1. WCAG 1.4.11 asks for contrast on the
       information REQUIRED to identify a control, and the numeral does that at
       11.7-14.0:1; the circle is decoration. iOS's keypad works the same way.
       Measured — numeral-on-face <...>, key-vs-page <...>. */
    --key-face: color-mix(in srgb, var(--accent) 16%, transparent);
    --key-face-pressed: color-mix(in srgb, var(--accent) 28%, transparent);

    /* Focus ring. Unlike the key face this one IS required to reach 3:1 and is
       achievable, so it gets a token instead of the raw accent — which measured
       ~2.9:1 on eatout. Same derive-per-scheme pattern as --bar-* / --danger-ink.
       Measured vs page — <...>. */
    --focus-ring: color-mix(in srgb, var(--accent) 75%, black);
```

In the `@media (prefers-color-scheme: dark)` `:root` block, after the `--danger-ink` line, add:

```css
        /* Re-derived for the dark page. Measured — numeral-on-face <...>,
           key-vs-page <...>, focus-ring-vs-page <...>. */
        --key-face: color-mix(in srgb, var(--accent) 20%, transparent);
        --key-face-pressed: color-mix(in srgb, var(--accent) 32%, transparent);
        --focus-ring: color-mix(in srgb, var(--accent) 70%, #ffffff);
```

In `.pin-key`, replace:

```css
    background: var(--surface);
    box-shadow: var(--shadow);
```

with:

```css
    background: var(--key-face);
```

Replace the `.pin-key:active` rule with:

```css
.pin-key:active {
    transform: scale(0.92);
    background: var(--key-face-pressed);
}
```

Replace the `:focus-visible` rule's outline colour:

```css
:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
    border-radius: var(--r-sm);
}
```

- [ ] **Step 5: Drop the dialler letters**

In `frontend/index.html`, remove every `<span class="key-letters">…</span>` from both PIN pads (12 spans total across the two screens). They are phone-dialler affordances and mean nothing for a numeric PIN. Leave the `.key-letters` CSS rule in place — it is harmless and removing it is unrelated churn.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd frontend && bun test test/ui_lockscreen_css.test.js`
Expected: PASS.

- [ ] **Step 7: Run the whole suite and lint**

Run: `cd frontend && bun test && bun run lint`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/css/styles.css frontend/index.html frontend/test/ui_lockscreen_css.test.js
git commit -m "feat(ui): give PIN keys a face that survives dark mode

The keys were background:var(--surface) plus box-shadow. In dark mode
--surface is color-mix(accent 5%, #14171d) — within a hair of the page
background — and the shadow is rgba(0,0,0,...) against near-black, so the
keys measured 1.05-1.07:1 (light) and 1.10:1 (dark) against the page. They
were defined by almost nothing.

They now take an accent-derived tint, re-derived for the dark page, so they
read identically in both schemes and pick up each instance's colour with no
per-instance CSS: kids keys go blue, eatout warm.

A 3:1 key boundary was deliberately not chased, because it is unreachable
with this palette. eatout's accent (#E07856) cannot reach 3:1 against its
own light background at ANY alpha, and a neutral face that does reach it
needs ink at 48% — #8b8e92 keys that read as disabled, with numeral
contrast falling from ~13:1 to ~5:1. WCAG 1.4.11 asks for contrast on the
information required to IDENTIFY a control; the numeral does that at
11.7-14.0:1 and the circle is decoration, which is how iOS's own keypad
works. The measured figures are recorded beside the tokens so nobody has to
re-derive them.

The focus ring is the opposite case: outline:2px solid var(--accent)
measured ~2.9:1 on eatout, and unlike the key face 3:1 is both required and
achievable. It gets a --focus-ring token following the same per-scheme
derive pattern as --bar-* and --danger-ink.

ABC/DEF dialler letters dropped — meaningless for a numeric PIN."
```

---

### Task 6: Identity mark and the auto-submit announcement

**Files:**
- Modify: `frontend/index.html` (mark in both screens)
- Modify: `frontend/js/auth.js` (announce)
- Modify: `frontend/test/auth_autosubmit.test.js` (add a describe block)

**Interfaces:**
- Consumes: `.pin-identity`/`.pin-mark` from Task 4; `prepareAuthScreen` from Task 2.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Append to `frontend/test/auth_autosubmit.test.js`:

```js
// Auto-submit acts without the user pressing anything, so a screen-reader user
// would otherwise get no signal that a verify is under way.
describe('auto-submit is announced', () => {
    test('the live region reports verifying when entry submits itself', async () => {
        rememberPinLength(4);
        auth.prepareAuthScreen();
        const display = document.getElementById('auth-pin-display');
        expect(display.getAttribute('aria-live')).toBe('polite');
        type('1234');
        await Promise.resolve();
        expect(display.getAttribute('aria-label')).toMatch(/verifying/i);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && bun test test/auth_autosubmit.test.js`
Expected: FAIL — `aria-label` is still `"4 digits entered"`.

- [ ] **Step 3: Announce in `submitAuth`**

In `frontend/js/auth.js`, at the very start of `submitAuth()`, after the `if (this.isLoading) return;` guard, add:

```js
        // Auto-submit fires without the user pressing anything, so the live
        // region has to say a verify started. The dots container is already
        // role="status" aria-live="polite", so writing its label announces.
        const display = document.getElementById('auth-pin-display');
        if (display) display.setAttribute('aria-label', labels.auth_verifying || 'Verifying');
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && bun test test/auth_autosubmit.test.js`
Expected: PASS.

- [ ] **Step 5: Add the identity mark to the markup**

In `frontend/index.html`, as the first child of `.pin-identity` in **both** `#auth-screen` and `#setup-screen`, add:

```html
                <img src="assets/icon.svg" alt="" class="pin-mark" aria-hidden="true">
```

`alt=""` plus `aria-hidden` because the `<h1>` beside it already names the app — announcing the mark too would just repeat it. CI overwrites `assets/icon.svg` with the per-instance icon when `frontend/assets/icons/<instance>.svg` exists, so this picks up each instance's mark with no per-instance markup.

- [ ] **Step 6: Run the whole suite and lint**

Run: `cd frontend && bun test && bun run lint`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/index.html frontend/js/auth.js frontend/test/auth_autosubmit.test.js
git commit -m "feat(ui): identity mark on the PIN screens, and announce auto-submit

The lock screen had no app identity beyond a text title, despite a
per-instance PWA icon already shipping. Both PIN screens now show it. It is
alt=\"\" and aria-hidden because the h1 beside it already names the app, so
announcing the mark would only repeat it. CI already overwrites
assets/icon.svg with assets/icons/<instance>.svg where one exists, so each
instance gets its own mark with no per-instance markup.

Auto-submit acts without the user pressing anything, which leaves a
screen-reader user with no signal that a verify started. The dots container
is already role=status aria-live=polite, so submitAuth now writes the
verifying label there."
```

---

### Task 7: Verification and manual device pass

**Files:** none modified unless a defect is found.

- [ ] **Step 1: Full automated pass**

```bash
cd frontend && bun test && bun run lint
cd .. && ./scripts/test/add-data.test.sh
cd backend && export PATH=$HOME/sdk/go/bin:$PATH && gofmt -l ./cmd ./internal && go vet ./... && go test ./...
```

Expected: frontend green with the new files included; shell suite 37 tests 0 failed; backend untouched and green.

- [ ] **Step 2: Confirm the CSS tests can actually fail**

A stylesheet-text test that cannot fail is worse than none. Temporarily revert one property at a time and confirm a failure, restoring after each:

1. Put `justify-content: center` back on `.pin-container` → the layout test must fail.
2. Put `width: 72px` back on `.pin-key` → the fluid-key test must fail.
3. Change `.pin-key`'s background back to `var(--surface)` → the key-face test must fail.
4. Point `:focus-visible` back at `var(--accent)` → the focus-ring test must fail.

Restore the file and re-run to confirm a clean baseline. `git diff --stat frontend/css/styles.css` must be empty afterwards.

- [ ] **Step 3: Manual device checks — not automatable here**

happy-dom has no layout engine, so these cannot be asserted in the suite. Serve the frontend locally and check on a real phone, in **both** schemes and **both** instances:

- The pad sits within thumb reach and clears the home indicator.
- Nothing moves after first paint on a device with biometrics enrolled.
- A 4-digit PIN shows four dots and unlocks with no `OK` tap.
- Landscape does not clip or overflow.
- Keys are clearly visible in dark mode — the specific thing this rework fixes.
- Setup flow still works end to end, still requires `OK`, and still shows six dots.

- [ ] **Step 4: Update the spec status**

In `docs/superpowers/specs/2026-07-29-lock-screen-design.md`, change the `Status:` line to `implemented in <branch/PR>`, and record anything that turned out differently from the design under a new `## Deviations` heading. If nothing deviated, write `None.` — an empty heading is worse than an explicit statement.

- [ ] **Step 5: Commit and open the PR**

```bash
git add -A && git commit -m "docs: mark the lock screen design implemented"
git push -u origin feat/lock-screen
```

Then open a PR describing: the four measured problems fixed, the two deliberate trade-offs from the spec's risk section (auto-submit removes the chance to review a mistyped last digit; bottom-anchoring changes muscle memory), and the fact that a 3:1 key boundary was unreachable and why that is the correct reading rather than a compromise.

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: thumb-first layout → Task 4; tinted wash + focus ring → Task 5; auto-submit with length memory and self-heal → Tasks 1–2; no-layout-shift biometric slot → Task 3; setup exclusion → Task 2 Step 1 (tests) and by construction, since `handleSetupInput` is a separate method; a11y announcement → Task 6; identity mark → Task 6; short-viewport rule → Task 4; measured-figures-in-comments → Task 5 Steps 1 and 4; manual device checks → Task 7 Step 3.

**Placeholder scan.** No TBD/TODO. Every code step carries real code. The only intentional blanks are the `<...>` ratio placeholders in Task 5 Step 4, which Step 1 requires be measured first — deliberate, because writing invented contrast numbers is the failure mode being guarded against.

**Type consistency.** `pin_memory.js` exports the same eight names in Task 1's test, Task 1's implementation, and the import lists in Tasks 2 and 3. `ui.renderPinDots(containerId, count)` is defined in Task 2 Step 3 and used in Task 2 Step 4. `auth.prepareAuthScreen()`, `auth.primeBiometricSlot()`, `auth.pinLength` and `auth.staleLengthThreshold` are consistent across Tasks 2, 3 and 6. `#biometric-slot` and `.filled` are consistent across Tasks 3 and 4. `--key-face`, `--key-face-pressed` and `--focus-ring` are consistent between Task 5's test and implementation.

**Caught in review.** Task 4's replacement range spans `.pin-container h1`,
`.pin-container p` and `.pin-hint`, which the first draft's block omitted — and
the new short-viewport rule targets two of them, so following the instruction
literally would have left the title unstyled and the media query pointing at
nothing. All three are now reproduced in the block and the span is stated
explicitly.

**One risk the plan carries.** Task 2 changes three `ui.updatePinDisplay('auth-pin-display', 0)` call sites in `submitAuth` to `this.prepareAuthScreen()`. If `auth_lockout.test.js`'s fixture lacks the `clear` key, those tests fail — Task 2 Step 6 says so explicitly and tells the implementer to extend the fixture rather than guess.
