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
