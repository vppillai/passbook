// Authentication Module
import { api } from './api.js';
import * as ui from './ui.js';

class Auth {
    constructor() {
        this.pin = '';
        this.confirmPin = '';
        this.isConfirmMode = false;
        this.isLoading = false;
        this.onAuthSuccess = null;
    }

    init(onAuthSuccess) {
        this.onAuthSuccess = onAuthSuccess;
        this.bindEvents();
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
    }

    setLoading(loading, screen = 'auth') {
        this.isLoading = loading;
        const message = screen === 'setup'
            ? document.getElementById('setup-message')
            : document.getElementById('auth-message');

        if (loading) {
            message.innerHTML = '<span class="loading-dots">Verifying</span>';
            document.querySelectorAll('.pin-key').forEach(key => key.disabled = true);
        } else {
            document.querySelectorAll('.pin-key').forEach(key => key.disabled = false);
        }
    }

    handleSetupInput(value) {
        ui.hideError('setup-error');

        if (value === 'clear') {
            this.pin = '';
            this.confirmPin = '';
            this.isConfirmMode = false;
            document.getElementById('setup-message').textContent = 'Create your PIN (4-6 digits)';
            ui.updatePinDisplay('setup-screen', 0);
            return;
        }

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

        if (value === 'clear') {
            this.pin = '';
            ui.updatePinDisplay('auth-pin-display', 0);
            return;
        }

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
                this.pin = '';
                ui.updatePinDisplay('auth-pin-display', 0);
                if (this.onAuthSuccess) {
                    this.onAuthSuccess();
                }
            } else {
                ui.showPinError('auth-pin-display');
                this.pin = '';

                if (result.locked_until) {
                    const lockTime = new Date(result.locked_until * 1000);
                    ui.showError('auth-error', `Account locked until ${lockTime.toLocaleTimeString()}`);
                } else if (result.attempts_remaining !== undefined) {
                    ui.showError('auth-error', `Invalid PIN. ${result.attempts_remaining} attempts remaining.`);
                } else {
                    ui.showError('auth-error', result.error || 'Invalid PIN');
                }
            }
        } catch (error) {
            this.setLoading(false, 'auth');
            document.getElementById('auth-message').textContent = 'Enter your PIN';
            ui.showPinError('auth-pin-display');
            this.pin = '';
            ui.showError('auth-error', error.message);
        }
    }

    async logout() {
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
        this.pin = '';
        this.confirmPin = '';
        this.isConfirmMode = false;
        this.isLoading = false;
    }
}

export const auth = new Auth();
