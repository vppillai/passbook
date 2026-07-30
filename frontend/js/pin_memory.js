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
