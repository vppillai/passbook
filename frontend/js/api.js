// API Client for Passbook Backend
// API_BASE will be injected during build, defaulting to empty for local testing
const API_BASE = window.PASSBOOK_API_URL || '';

class Api {
    constructor() {
        this.sessionToken = sessionStorage.getItem('session') || null;
    }

    async request(method, endpoint, body = null) {
        const headers = {
            'Content-Type': 'application/json',
        };

        if (this.sessionToken) {
            headers['X-Session-Token'] = this.sessionToken;
        }

        const options = {
            method,
            headers,
            credentials: 'omit', // Don't send cookies
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(`${API_BASE}${endpoint}`, options);

        // Handle unauthorized
        if (response.status === 401) {
            this.clearSession();
            window.dispatchEvent(new CustomEvent('session-expired'));
            throw new Error('Session expired');
        }

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Request failed');
        }

        return data;
    }

    setSession(token) {
        this.sessionToken = token;
        sessionStorage.setItem('session', token);
    }

    clearSession() {
        this.sessionToken = null;
        sessionStorage.removeItem('session');
    }

    hasSession() {
        return !!this.sessionToken;
    }

    // Auth endpoints
    async checkSetup() {
        const data = await this.request('GET', '/api/auth/status');
        return data.is_setup;
    }

    async setupPin(pin) {
        return this.request('POST', '/api/auth/setup', { pin });
    }

    async verifyPin(pin) {
        const result = await this.request('POST', '/api/auth/verify', { pin });
        if (result.success && result.token) {
            this.setSession(result.token);
        }
        return result;
    }

    async changePin(currentPin, newPin) {
        return this.request('POST', '/api/auth/change', {
            current_pin: currentPin,
            new_pin: newPin,
        });
    }

    async logout() {
        try {
            await this.request('POST', '/api/auth/logout');
        } finally {
            this.clearSession();
        }
    }

    // Data endpoints
    async getBalance() {
        return this.request('GET', '/api/balance');
    }

    async getMonth(monthKey) {
        return this.request('GET', `/api/month/${monthKey}`);
    }

    async getMonths() {
        return this.request('GET', '/api/months');
    }

    async addExpense(amount, description) {
        return this.request('POST', '/api/expense', { amount, description });
    }

    async deleteExpense(month, expenseId) {
        return this.request('DELETE', `/api/expense/${month}/${expenseId}`);
    }
}

export const api = new Api();
