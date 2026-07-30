// Authentication Module
import { api } from './api.js';
import * as ui from './ui.js';
import { labels } from './labels.js';
import * as webauthn from './webauthn.js';
import {
    rememberPinLength, recalledPinLength, forgetPinLength,
    noteFailedAttempt, clearFailedAttempts,
    rememberBiometricAvailable, recalledBiometricAvailable,
} from './pin_memory.js';

// Per-instance localStorage flag remembering that the user dismissed (or
// completed) the one-time "enable biometric unlock" offer, so we don't nag on
// every login. Namespaced by instance like the session key.
function detectInstance() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[0] === 'passbook') return parts[1];
    return parts[parts.length - 1] || 'default';
}
const BIOMETRIC_PROMPT_KEY = `passbook_webauthn_prompted_${detectInstance()}`;

/**
 * Formats a remaining-seconds count as "M:SS" (e.g. 65 → "1:05").
 * Rounds up so the display never shows "0:00" while still locked.
 * @param {number} seconds - remaining seconds (may be fractional)
 * @returns {string}
 */
export function formatCountdown(seconds) {
    const s = Math.ceil(seconds);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${String(rem).padStart(2, '0')}`;
}

class Auth {
    constructor() {
        this.pin = '';
        this.confirmPin = '';
        this.isConfirmMode = false;
        this.isLoading = false;
        this.onAuthSuccess = null;
        this.bound = false;
        /** @type {number|null} setInterval id for the lockout countdown */
        this._lockoutInterval = null;
        /** @type {number|null} PIN length this device has learned; null = unknown.
         *  When known the screen renders exactly that many dots and submits on
         *  the last digit; when unknown it falls back to six dots and OK. */
        this.pinLength = null;
        /** Consecutive failures needed before a remembered length is dropped.
         *  Two, not one: a single wrong PIN of the right length is an ordinary
         *  fumble, but two in a row is the signature of a length that has gone
         *  stale (PIN changed on another device). */
        this.staleLengthThreshold = 2;
    }

    init(onAuthSuccess) {
        this.onAuthSuccess = onAuthSuccess;
        // Bind event listeners exactly once. Previously, init() was called
        // multiple times (once per branch of app.init()'s setup/session/
        // hasSession path AND again after session-expired re-auth), stacking
        // duplicate click listeners on the PIN pads. Each keypress then
        // fired N times → double-submitted PINs and tripped the rate-limit
        // for legitimate users.
        if (!this.bound) {
            this.bindEvents();
            this.bound = true;
        }
        // Show the lock-screen biometric button when enrolled + available
        // (fire-and-forget; PIN remains the fallback regardless).
        this.primeBiometricSlot();
        this.refreshBiometricButton();
        this.prepareAuthScreen();
    }

    /**
     * True while a rate-limit countdown is running. _startLockout disables
     * the on-screen pad's buttons, but that only stops the mouse/touch path:
     * the physical-keyboard handler synthesises the same input and never
     * looks at the buttons. Both routes funnel through handleAuthInput, so
     * that is where this is enforced.
     * @returns {boolean}
     */
    _isLockedOut() {
        return this._lockoutInterval !== null;
    }

    /** Cancels any running lockout countdown and re-enables the PIN pad. */
    _clearLockout() {
        if (this._lockoutInterval !== null) {
            clearInterval(this._lockoutInterval);
            this._lockoutInterval = null;
        }
        // Re-enable pad (setLoading(false) re-enables .pin-key buttons, but
        // lockout bypasses setLoading, so we do it directly).
        document.querySelectorAll('#auth-pin-pad .pin-key').forEach(k => { k.disabled = false; });
    }

    /**
     * Starts a live M:SS countdown in the auth-error element and disables the
     * PIN pad for the duration. Re-enables everything at zero.
     * @param {number} retryAfterSeconds
     */
    _startLockout(retryAfterSeconds) {
        this._clearLockout();
        this.isLoading = false; // allow the interval tick to re-read state

        const endMs = Date.now() + retryAfterSeconds * 1000;

        // Disable the entire auth PIN pad while locked.
        document.querySelectorAll('#auth-pin-pad .pin-key').forEach(k => { k.disabled = true; });

        const tick = () => {
            const remaining = (endMs - Date.now()) / 1000;
            if (remaining <= 0) {
                this._clearLockout();
                ui.hideError('auth-error');
                document.getElementById('auth-message').textContent = labels.auth_enter_pin;
                return;
            }
            const msg = labels.auth_too_many_attempts.replace('{time}', formatCountdown(remaining));
            ui.showError('auth-error', msg);
        };

        tick(); // show immediately without waiting one second
        this._lockoutInterval = setInterval(tick, 250);
    }

    // =================================================================
    // WebAuthn (biometric unlock)
    // =================================================================

    /**
     * Refreshes the lock screen's biometric affordance: when the server
     * reports an enrolled credential AND the platform authenticator is
     * available, injects a "Use biometrics" button above the PIN pad; removes
     * it otherwise. Safe to call repeatedly (idempotent). PIN always remains
     * as the fallback. Errors are swallowed so a status hiccup never blocks
     * the PIN path.
     */
    async refreshBiometricButton() {
        try {
            if (!webauthn.isWebAuthnSupported()) {
                this._removeBiometricButton();
                return;
            }
            const [status, available] = await Promise.all([
                webauthn.getAuthStatus(),
                webauthn.isPlatformAuthenticatorAvailable(),
            ]);
            const enrolled = !!(status && status.webauthn_enrolled) && available;
            rememberBiometricAvailable(enrolled);
            if (enrolled) {
                this._injectBiometricButton();
            } else {
                this._removeBiometricButton();
            }
        } catch {
            this._removeBiometricButton();
        }
    }

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

    /**
     * Runs the biometric login ceremony. On success the server returns the
     * same body as a PIN verify ({success, token}); we store the token via the
     * existing api.setSession path and follow the same onAuthSuccess flow as
     * PIN. Any failure (including a dismissed prompt) falls back quietly to the
     * PIN pad, surfacing a message in the existing error element only for
     * genuine server errors — not for a user cancellation.
     */
    async loginWithBiometrics() {
        if (this.isLoading) return;
        ui.hideError('auth-error');
        this.setLoading(true, 'auth');
        try {
            const result = await webauthn.login();
            this.setLoading(false, 'auth');
            document.getElementById('auth-message').textContent = labels.auth_enter_pin;

            if (result && result.success && result.token) {
                // Mirror api.verifyPin's success path: persist the session,
                // then run the shared post-auth flow.
                api.setSession(result.token);
                this._clearLockout();
                this.pin = '';
                ui.updatePinDisplay('auth-pin-display', 0);
                if (this.onAuthSuccess) this.onAuthSuccess();
                return;
            }
            // Server replied 200 but not success — show the message, keep PIN.
            ui.showError('auth-error', (result && result.error) || labels.auth_biometric_failed || 'Biometric unlock failed');
        } catch (error) {
            this.setLoading(false, 'auth');
            document.getElementById('auth-message').textContent = labels.auth_enter_pin;

            // A 429 lockout from the shared rate limiter: reuse the PIN countdown.
            if (error.status === 429 && error.retry_after_seconds) {
                this._startLockout(error.retry_after_seconds);
                return;
            }
            // NotAllowedError / AbortError = the user dismissed the OS prompt.
            // That's not an error worth shouting about — fall back silently.
            if (error.name === 'NotAllowedError' || error.name === 'AbortError') {
                return;
            }
            ui.showError('auth-error', error.message || labels.auth_biometric_failed || 'Biometric unlock failed');
        }
    }

    /**
     * One-time offer, shown after a successful PIN login, to enable biometric
     * unlock. Only fires when the platform authenticator is available, no
     * credential is enrolled yet, and the user hasn't been prompted before
     * (remembered in localStorage so we never nag). Accepting runs the
     * registration ceremony; any outcome marks the offer as shown.
     */
    async maybeOfferBiometricEnrollment() {
        try {
            if (localStorage.getItem(BIOMETRIC_PROMPT_KEY)) return;
            if (!webauthn.isWebAuthnSupported()) return;
            const [status, available] = await Promise.all([
                webauthn.getAuthStatus(),
                webauthn.isPlatformAuthenticatorAvailable(),
            ]);
            if (!available) return;
            if (status && status.webauthn_enrolled) return;

            const accepted = await ui.showConfirm({
                title: labels.auth_enable_biometrics_title || 'Enable fingerprint/Face unlock?',
                body: labels.auth_enable_biometrics_body || 'Unlock the app with your fingerprint or face instead of typing your PIN. You can turn this off anytime.',
                confirmText: labels.auth_enable_biometrics_confirm || 'Enable',
                cancelText: labels.auth_enable_biometrics_cancel || 'Not now',
            });
            // Record that we've offered, regardless of the choice, so the
            // prompt is one-time.
            localStorage.setItem(BIOMETRIC_PROMPT_KEY, '1');
            if (!accepted) return;

            try {
                await webauthn.register();
                ui.showToast(labels.auth_biometrics_enabled || 'Biometric unlock enabled', 'success');
            } catch (error) {
                // Quietly ignore a dismissed OS prompt; surface real failures.
                if (error.name !== 'NotAllowedError' && error.name !== 'AbortError') {
                    ui.showToast(labels.auth_biometrics_enable_failed || 'Could not enable biometric unlock', 'error');
                }
            }
        } catch {
            // Never let the offer break the post-login flow.
        }
    }

    bindEvents() {
        // Setup PIN pad
        document.getElementById('setup-pin-pad').addEventListener('click', (e) => {
            const key = e.target.closest('.pin-key');
            if (key && !this.isLoading) this.handleSetupInput(key.dataset.value);
        });

        // Auth PIN pad
        document.getElementById('auth-pin-pad').addEventListener('click', (e) => {
            const key = e.target.closest('.pin-key');
            if (key && !this.isLoading) this.handleAuthInput(key.dataset.value);
        });

        // Physical keyboard support (a11y): on the setup/auth screens, digits
        // enter the PIN, Backspace deletes, Enter submits — mirroring the
        // on-screen pad so the app is usable without a touchscreen or mouse.
        document.addEventListener('keydown', (e) => this.handlePhysicalKey(e));
    }

    handlePhysicalKey(e) {
        if (this.isLoading) return;
        // Route to whichever PIN screen is currently visible; ignore otherwise
        // (e.g. while a modal or the dashboard is up).
        //
        // Both lookups are null-guarded because this is a DOCUMENT-level
        // handler: it stays attached for the life of the page and fires for
        // every keystroke, so it must not assume the PIN screens are in the
        // DOM. Dereferencing a missing element throws inside an event handler,
        // where the failure is silent and swallows the keystroke.
        const setupScreen = document.getElementById('setup-screen');
        const authScreen = document.getElementById('auth-screen');
        if (!setupScreen && !authScreen) return;
        const setupVisible = !!setupScreen && !setupScreen.classList.contains('hidden');
        const authVisible = !!authScreen && !authScreen.classList.contains('hidden');
        if (!setupVisible && !authVisible) return;
        // Don't hijack keys while focus is in a text field.
        const tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        let value = null;
        if (/^[0-9]$/.test(e.key)) value = e.key;
        else if (e.key === 'Backspace') value = 'back';
        else if (e.key === 'Enter') value = 'submit';
        if (value === null) return;

        e.preventDefault();
        if (setupVisible) this.handleSetupInput(value);
        else this.handleAuthInput(value);
    }

    setLoading(loading, screen = 'auth') {
        this.isLoading = loading;
        const message = screen === 'setup'
            ? document.getElementById('setup-message')
            : document.getElementById('auth-message');
        const pinDisplay = screen === 'setup'
            ? document.querySelector('#setup-screen .pin-display')
            : document.getElementById('auth-pin-display');

        if (loading) {
            // Build "Verifying..." via DOM nodes (not innerHTML) so this stays
            // safe even if a future change pipes localized text through it.
            message.textContent = labels.auth_verifying;
            for (let i = 0; i < 3; i++) {
                const dot = document.createElement('span');
                dot.className = 'dot';
                dot.textContent = '.';
                message.appendChild(dot);
            }
            pinDisplay.classList.add('loading');
            document.querySelectorAll('.pin-key').forEach(key => key.disabled = true);
        } else {
            pinDisplay.classList.remove('loading');
            document.querySelectorAll('.pin-key').forEach(key => key.disabled = false);
        }
    }

    handleSetupInput(value) {
        ui.hideError('setup-error');

        if (value === 'back') {
            if (this.isConfirmMode) {
                if (this.confirmPin.length > 0) {
                    this.confirmPin = this.confirmPin.slice(0, -1);
                    ui.updatePinDisplay('setup-screen', this.confirmPin.length);
                } else {
                    // Go back to first PIN entry
                    this.isConfirmMode = false;
                    document.getElementById('setup-message').textContent = labels.setup_create_pin;
                    ui.updatePinDisplay('setup-screen', this.pin.length);
                }
            } else {
                this.pin = this.pin.slice(0, -1);
                ui.updatePinDisplay('setup-screen', this.pin.length);
            }
            return;
        }

        if (value === 'submit') {
            if (this.isConfirmMode) {
                if (this.confirmPin.length >= 4) {
                    this.submitSetup();
                }
            } else {
                if (this.pin.length >= 4) {
                    // Move to confirm mode
                    this.isConfirmMode = true;
                    document.getElementById('setup-message').textContent = labels.setup_confirm_pin;
                    ui.updatePinDisplay('setup-screen', 0);
                }
            }
            return;
        }

        // Add digit
        if (this.isConfirmMode) {
            if (this.confirmPin.length < 6) {
                this.confirmPin += value;
                ui.updatePinDisplay('setup-screen', this.confirmPin.length);
            }
        } else {
            if (this.pin.length < 6) {
                this.pin += value;
                ui.updatePinDisplay('setup-screen', this.pin.length);
            }
        }
    }

    async submitSetup() {
        if (this.isLoading) return;

        ui.hideError('setup-error');

        if (this.pin !== this.confirmPin) {
            ui.showError('setup-error', labels.setup_pins_no_match);
            ui.showPinError('setup-screen');
            this.pin = '';
            this.confirmPin = '';
            this.isConfirmMode = false;
            document.getElementById('setup-message').textContent = labels.setup_create_pin;
            return;
        }

        this.setLoading(true, 'setup');

        try {
            await api.setupPin(this.pin);
            this.setLoading(false, 'setup');
            ui.showToast(labels.pin_created_toast, 'success');

            const savedPin = this.pin;
            this.pin = '';
            this.confirmPin = '';
            this.isConfirmMode = false;

            // Auto-login after setup
            document.getElementById('auth-message').textContent = labels.auth_logging_in;
            ui.showScreen('auth-screen');

            this.setLoading(true, 'auth');
            const result = await api.verifyPin(savedPin);
            this.setLoading(false, 'auth');

            if (result.success && this.onAuthSuccess) {
                this.onAuthSuccess();
                // One-time offer to enable biometric unlock after first login.
                this.maybeOfferBiometricEnrollment();
            } else {
                document.getElementById('auth-message').textContent = labels.auth_enter_pin;
            }
        } catch (error) {
            this.setLoading(false, 'setup');
            ui.showError('setup-error', error.message);
            ui.showPinError('setup-screen');
            this.pin = '';
            this.confirmPin = '';
            this.isConfirmMode = false;
            document.getElementById('setup-message').textContent = labels.setup_create_pin;
        }
    }

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

    handleAuthInput(value) {
        // Refuse every input while the lockout countdown is showing. Both the
        // on-screen pad and the physical keyboard land here, so one check
        // covers both; previously the keyboard route stayed live and could
        // fire a real verify request underneath a "try again in 2:34"
        // message, which the server then refused anyway.
        if (this._isLockedOut()) return;
        ui.hideError('auth-error');

        if (value === 'back') {
            this.pin = this.pin.slice(0, -1);
            ui.updatePinDisplay('auth-pin-display', this.pin.length);
            return;
        }

        if (value === 'submit') {
            if (this.pin.length >= 4) {
                this.submitAuth();
            }
            return;
        }

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

    async submitAuth() {
        if (this.isLoading) return;

        // Auto-submit fires without the user pressing anything, so the live
        // region has to say a verify started. The dots container is already
        // role="status" aria-live="polite", so writing its label announces.
        const display = document.getElementById('auth-pin-display');
        if (display) display.setAttribute('aria-label', labels.auth_verifying || 'Verifying');

        ui.hideError('auth-error');
        this.setLoading(true, 'auth');

        try {
            const result = await api.verifyPin(this.pin);
            this.setLoading(false, 'auth');
            document.getElementById('auth-message').textContent = labels.auth_enter_pin;

            if (result.success) {
                this._clearLockout();
                // The entry was correct, so its length is authoritative.
                rememberPinLength(this.pin.length);
                clearFailedAttempts();
                this.pin = '';
                this.prepareAuthScreen();
                if (this.onAuthSuccess) {
                    this.onAuthSuccess();
                }
                // One-time offer to enable biometric unlock (fire-and-forget;
                // never blocks the post-login transition).
                this.maybeOfferBiometricEnrollment();
            } else {
                // Drop a remembered length that has gone stale, so the screen
                // stops auto-submitting at a count that can never succeed.
                // Runs BEFORE prepareAuthScreen so the rebuilt dots reflect the
                // count we just settled on.
                if (this.pinLength !== null &&
                    noteFailedAttempt() >= this.staleLengthThreshold) {
                    forgetPinLength();
                }
                this.pin = '';
                this.prepareAuthScreen();
                // AFTER the rebuild, never before. prepareAuthScreen renders the
                // dots through renderPinDots, which clears the container — so
                // marking them first left the .error class on detached nodes and
                // the 300ms shake never painted. The catch block's 429/401 paths
                // already ordered it this way; this branch did not.
                ui.showPinError('auth-pin-display');

                // attempts_remaining is omitted (omitempty) once it hits 0,
                // so the cap message falls through to result.error.
                if (result.attempts_remaining !== undefined) {
                    ui.showError('auth-error',
                        labels.auth_wrong_pin.replace('{n}', result.attempts_remaining));
                } else {
                    ui.showError('auth-error', result.error || labels.auth_wrong_pin_no_remaining);
                }
            }
        } catch (error) {
            this.setLoading(false, 'auth');
            this.pin = '';
            this.prepareAuthScreen();

            // 429 from an auth endpoint: structured lockout with countdown.
            if (error.status === 429 && error.retry_after_seconds) {
                document.getElementById('auth-message').textContent = labels.auth_enter_pin;
                ui.showPinError('auth-pin-display');
                this._startLockout(error.retry_after_seconds);
                return;
            }

            // 401 from an auth endpoint: structured wrong-PIN response.
            if (error.status === 401) {
                document.getElementById('auth-message').textContent = labels.auth_enter_pin;
                ui.showPinError('auth-pin-display');
                const d = error.responseData;
                if (d && d.attempts_remaining !== undefined) {
                    ui.showError('auth-error',
                        labels.auth_wrong_pin.replace('{n}', d.attempts_remaining));
                } else {
                    ui.showError('auth-error', (d && d.error) || labels.auth_wrong_pin_no_remaining);
                }
                return;
            }

            document.getElementById('auth-message').textContent = labels.auth_enter_pin;
            ui.showPinError('auth-pin-display');
            ui.showError('auth-error', error.message);
        }
    }

    async logout() {
        this._clearLockout();
        try {
            await api.logout();
        } catch (e) {
            // Ignore errors
        }
        this.pin = '';
        ui.updatePinDisplay('auth-pin-display', 0);
        ui.showScreen('auth-screen');
        ui.hideMenu();
        // Re-evaluate the lock-screen biometric button for the next unlock.
        this.refreshBiometricButton();
    }

    reset() {
        this._clearLockout();
        this.pin = '';
        this.confirmPin = '';
        this.isConfirmMode = false;
        this.isLoading = false;
    }
}

export const auth = new Auth();
