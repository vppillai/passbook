// Authentication Module
import { api } from './api.js';
import * as ui from './ui.js';
import { labels } from './labels.js';

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
                document.getElementById('auth-message').textContent = 'Enter your PIN';
                return;
            }
            const msg = labels.auth_too_many_attempts.replace('{time}', formatCountdown(remaining));
            ui.showError('auth-error', msg);
        };

        tick(); // show immediately without waiting one second
        this._lockoutInterval = setInterval(tick, 250);
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
        const setupVisible = !document.getElementById('setup-screen').classList.contains('hidden');
        const authVisible = !document.getElementById('auth-screen').classList.contains('hidden');
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
            message.textContent = 'Verifying';
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
                    document.getElementById('setup-message').textContent = 'Create your PIN (4-6 digits)';
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
                    document.getElementById('setup-message').textContent = 'Confirm your PIN';
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
            ui.showError('setup-error', 'PINs do not match. Try again.');
            ui.showPinError('setup-screen');
            this.pin = '';
            this.confirmPin = '';
            this.isConfirmMode = false;
            document.getElementById('setup-message').textContent = 'Create your PIN (4-6 digits)';
            return;
        }

        this.setLoading(true, 'setup');

        try {
            await api.setupPin(this.pin);
            this.setLoading(false, 'setup');
            ui.showToast('PIN created successfully!', 'success');

            const savedPin = this.pin;
            this.pin = '';
            this.confirmPin = '';
            this.isConfirmMode = false;

            // Auto-login after setup
            document.getElementById('auth-message').textContent = 'Logging in...';
            ui.showScreen('auth-screen');

            this.setLoading(true, 'auth');
            const result = await api.verifyPin(savedPin);
            this.setLoading(false, 'auth');

            if (result.success && this.onAuthSuccess) {
                this.onAuthSuccess();
            } else {
                document.getElementById('auth-message').textContent = 'Enter your PIN';
            }
        } catch (error) {
            this.setLoading(false, 'setup');
            ui.showError('setup-error', error.message);
            ui.showPinError('setup-screen');
            this.pin = '';
            this.confirmPin = '';
            this.isConfirmMode = false;
            document.getElementById('setup-message').textContent = 'Create your PIN (4-6 digits)';
        }
    }

    handleAuthInput(value) {
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

        // Add digit
        if (this.pin.length < 6) {
            this.pin += value;
            ui.updatePinDisplay('auth-pin-display', this.pin.length);
        }
    }

    async submitAuth() {
        if (this.isLoading) return;

        ui.hideError('auth-error');
        this.setLoading(true, 'auth');

        try {
            const result = await api.verifyPin(this.pin);
            this.setLoading(false, 'auth');
            document.getElementById('auth-message').textContent = 'Enter your PIN';

            if (result.success) {
                this._clearLockout();
                this.pin = '';
                ui.updatePinDisplay('auth-pin-display', 0);
                if (this.onAuthSuccess) {
                    this.onAuthSuccess();
                }
            } else {
                ui.showPinError('auth-pin-display');
                this.pin = '';
                ui.updatePinDisplay('auth-pin-display', 0);

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
            ui.updatePinDisplay('auth-pin-display', 0);

            // 429 from an auth endpoint: structured lockout with countdown.
            if (error.status === 429 && error.retry_after_seconds) {
                document.getElementById('auth-message').textContent = 'Enter your PIN';
                ui.showPinError('auth-pin-display');
                this._startLockout(error.retry_after_seconds);
                return;
            }

            // 401 from an auth endpoint: structured wrong-PIN response.
            if (error.status === 401) {
                document.getElementById('auth-message').textContent = 'Enter your PIN';
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

            document.getElementById('auth-message').textContent = 'Enter your PIN';
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
