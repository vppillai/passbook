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
