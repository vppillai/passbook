// Authentication Module
import { api } from './api.js';
import * as ui from './ui.js';

class Auth {
    constructor() {
        this.pin = '';
        this.confirmPin = '';
        this.isSetupMode = false;
        this.isConfirmMode = false;
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
            if (key) this.handleSetupInput(key.dataset.value);
        });

        // Auth PIN pad
        document.getElementById('auth-pin-pad').addEventListener('click', (e) => {
            const key = e.target.closest('.pin-key');
            if (key) this.handleAuthInput(key.dataset.value);
        });
    }

    handleSetupInput(value) {
        if (value === 'clear') {
            this.pin = '';
            this.confirmPin = '';
            this.isConfirmMode = false;
            document.getElementById('setup-message').textContent = 'Create your PIN';
            ui.updatePinDisplay('setup-screen', 0);
            return;
        }

        if (value === 'back') {
            if (this.isConfirmMode) {
                this.confirmPin = this.confirmPin.slice(0, -1);
                ui.updatePinDisplay('setup-screen', this.confirmPin.length);
            } else {
                this.pin = this.pin.slice(0, -1);
                ui.updatePinDisplay('setup-screen', this.pin.length);
            }
            return;
        }

        // Add digit
        if (this.isConfirmMode) {
            if (this.confirmPin.length < 6) {
                this.confirmPin += value;
                ui.updatePinDisplay('setup-screen', this.confirmPin.length);

                if (this.confirmPin.length >= 4 && this.confirmPin.length === this.pin.length) {
                    this.submitSetup();
                }
            }
        } else {
            if (this.pin.length < 6) {
                this.pin += value;
                ui.updatePinDisplay('setup-screen', this.pin.length);

                // Auto-advance to confirm when 4-6 digits entered
                if (this.pin.length >= 4) {
                    // Small delay before advancing
                    setTimeout(() => {
                        if (this.pin.length >= 4 && !this.isConfirmMode) {
                            this.isConfirmMode = true;
                            document.getElementById('setup-message').textContent = 'Confirm your PIN';
                            ui.updatePinDisplay('setup-screen', 0);
                        }
                    }, 300);
                }
            }
        }
    }

    async submitSetup() {
        ui.hideError('setup-error');

        if (this.pin !== this.confirmPin) {
            ui.showError('setup-error', 'PINs do not match. Try again.');
            ui.showPinError('setup-screen');
            this.pin = '';
            this.confirmPin = '';
            this.isConfirmMode = false;
            document.getElementById('setup-message').textContent = 'Create your PIN';
            return;
        }

        try {
            await api.setupPin(this.pin);
            ui.showToast('PIN created successfully!', 'success');
            this.pin = '';
            this.confirmPin = '';
            this.isConfirmMode = false;

            // Now verify to get session
            ui.showScreen('auth-screen');
        } catch (error) {
            ui.showError('setup-error', error.message);
            ui.showPinError('setup-screen');
            this.pin = '';
            this.confirmPin = '';
            this.isConfirmMode = false;
            document.getElementById('setup-message').textContent = 'Create your PIN';
        }
    }

    handleAuthInput(value) {
        if (value === 'clear') {
            this.pin = '';
            ui.updatePinDisplay('auth-pin-display', 0);
            ui.hideError('auth-error');
            return;
        }

        if (value === 'back') {
            this.pin = this.pin.slice(0, -1);
            ui.updatePinDisplay('auth-pin-display', this.pin.length);
            return;
        }

        // Add digit
        if (this.pin.length < 6) {
            this.pin += value;
            ui.updatePinDisplay('auth-pin-display', this.pin.length);

            // Auto-submit when 4-6 digits entered
            if (this.pin.length >= 4) {
                setTimeout(() => {
                    if (this.pin.length >= 4) {
                        this.submitAuth();
                    }
                }, 300);
            }
        }
    }

    async submitAuth() {
        ui.hideError('auth-error');

        try {
            const result = await api.verifyPin(this.pin);

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
        ui.showScreen('auth-screen');
        ui.hideMenu();
    }

    reset() {
        this.pin = '';
        this.confirmPin = '';
        this.isConfirmMode = false;
        this.isSetupMode = false;
    }
}

export const auth = new Auth();
