/**
 * API Client for Passbook Backend
 *
 * Provides methods for all backend HTTP interactions including authentication,
 * expense management, month management, and balance queries. Uses session-token-based
 * authentication stored in sessionStorage.
 *
 * @module api
 */

// API_BASE will be injected during build, defaulting to empty for local testing
const API_BASE = window.PASSBOOK_API_URL || '';

class Api {
    constructor() {
        /** @type {string|null} Session token for authenticated requests, persisted in sessionStorage */
        this.sessionToken = localStorage.getItem('session') || null;
    }

    /**
     * Sends an HTTP request to the backend API.
     *
     * Automatically attaches the session token (if present) as the X-Session-Token header.
     * If the server responds with 401, the session is cleared and a 'session-expired' event
     * is dispatched on the window to trigger a re-authentication flow.
     *
     * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
     * @param {string} endpoint - API endpoint path (e.g. '/api/balance')
     * @param {Object|null} [body=null] - Request body to be JSON-serialized, or null for no body
     * @returns {Promise<Object>} Parsed JSON response from the server
     * @throws {Error} If the response is not OK or the session has expired
     */
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

    /**
     * Stores the session token in memory and sessionStorage for persistence across page reloads.
     * @param {string} token - The session token returned from a successful PIN verification
     */
    setSession(token) {
        this.sessionToken = token;
        localStorage.setItem('session', token);
    }

    /**
     * Removes the session token from memory and sessionStorage, effectively logging out.
     */
    clearSession() {
        this.sessionToken = null;
        localStorage.removeItem('session');
    }

    /**
     * Checks whether a session token exists (does not validate it with the server).
     * @returns {boolean} True if a session token is present
     */
    hasSession() {
        return !!this.sessionToken;
    }

    // ---- Auth endpoints ----

    /**
     * Checks whether the application has been set up with a PIN.
     * @returns {Promise<boolean>} True if a PIN has been configured
     */
    async checkSetup() {
        const data = await this.request('GET', '/api/auth/status');
        return data.is_setup;
    }

    /**
     * Sets the initial PIN during first-time application setup.
     * @param {string} pin - The PIN to set (4-6 digits)
     * @returns {Promise<Object>} Server response confirming setup
     */
    async setupPin(pin) {
        return this.request('POST', '/api/auth/setup', { pin });
    }

    /**
     * Verifies the user's PIN and stores the returned session token on success.
     * @param {string} pin - The PIN to verify
     * @returns {Promise<Object>} Response containing success status and token
     */
    async verifyPin(pin) {
        const result = await this.request('POST', '/api/auth/verify', { pin });
        if (result.success && result.token) {
            this.setSession(result.token);
        }
        return result;
    }

    /**
     * Changes the user's PIN after verifying the current one.
     * @param {string} currentPin - The user's current PIN for verification
     * @param {string} newPin - The new PIN to set (4-6 digits)
     * @returns {Promise<Object>} Server response confirming the change
     */
    async changePin(currentPin, newPin) {
        return this.request('POST', '/api/auth/change', {
            current_pin: currentPin,
            new_pin: newPin,
        });
    }

    /**
     * Logs out the user by invalidating the session server-side and clearing it locally.
     * The local session is always cleared, even if the server request fails.
     * @returns {Promise<void>}
     */
    async logout() {
        try {
            await this.request('POST', '/api/auth/logout');
        } finally {
            this.clearSession();
        }
    }

    // ---- Data endpoints ----

    /**
     * Fetches the user's overall account balance.
     * @returns {Promise<Object>} Response containing the total balance
     */
    async getBalance() {
        return this.request('GET', '/api/balance');
    }

    /**
     * Fetches data for a specific month, including its expenses (paginated).
     *
     * Expenses are returned in pages of up to 50 items. When more expenses exist
     * beyond the current page, the response includes a `next_cursor` token. Pass
     * that token as the `cursor` parameter in a subsequent call to retrieve the
     * next page of expenses.
     *
     * @param {string} monthKey - Month identifier in "YYYY-MM" format (e.g. "2025-03")
     * @param {string|null} [cursor=null] - Opaque pagination cursor from a previous response's
     *   `next_cursor` field. Pass null or omit to fetch the first page.
     * @returns {Promise<Object>} Month data including summary, expenses array, total_balance,
     *   and next_cursor (null if no more pages)
     */
    async getMonth(monthKey, cursor = null) {
        let url = `/api/month/${monthKey}?limit=50`;
        if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
        return this.request('GET', url);
    }

    /**
     * Fetches the list of all months (paginated), sorted in descending order (newest first).
     *
     * Each month entry includes the month key and its monthly_saved summary.
     * Results are paginated in pages of up to 50. When more months exist, the
     * response includes a `next_cursor` token for fetching subsequent pages.
     *
     * @param {string|null} [cursor=null] - Opaque pagination cursor from a previous response's
     *   `next_cursor` field. Pass null or omit to fetch the first page.
     * @returns {Promise<Object>} Object containing a `months` array and `next_cursor`
     *   (null if no more pages)
     */
    async getMonths(cursor = null) {
        let url = '/api/months?limit=50';
        if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
        return this.request('GET', url);
    }

    /**
     * Adds a new expense to the current month. If no month exists for the current
     * calendar month, the backend will automatically create one.
     * @param {number} amount - Expense amount in dollars (must be positive)
     * @param {string} description - Human-readable description of the expense
     * @returns {Promise<Object>} The created expense record
     */
    async addExpense(amount, description) {
        return this.request('POST', '/api/expense', { amount, description });
    }

    /**
     * Updates an existing expense's amount and/or description.
     *
     * The expense is identified by its month and unique ID. The ID is URL-encoded
     * because expense IDs may contain special characters (e.g. '#').
     *
     * @param {string} month - Month key in "YYYY-MM" format that the expense belongs to
     * @param {string} expenseId - Unique identifier of the expense to update
     * @param {number} amount - New expense amount in dollars (must be positive)
     * @param {string} description - New description for the expense
     * @returns {Promise<Object>} The updated expense record
     */
    async updateExpense(month, expenseId, amount, description) {
        return this.request('PUT', `/api/expense/${month}/${encodeURIComponent(expenseId)}`, {
            amount,
            description,
        });
    }

    /**
     * Deletes an expense from a given month.
     * @param {string} month - Month key in "YYYY-MM" format
     * @param {string} expenseId - Unique identifier of the expense to delete
     * @returns {Promise<Object>} Server response confirming deletion
     */
    async deleteExpense(month, expenseId) {
        // URL-encode the expense ID since it contains # characters
        return this.request('DELETE', `/api/expense/${month}/${encodeURIComponent(expenseId)}`);
    }

    /**
     * Creates a new month entry in the passbook.
     *
     * This allows manually creating a month (e.g. a future month or a past month
     * that was skipped). The backend will reject the request if the month already exists.
     *
     * @param {string} month - Month to create in "YYYY-MM" format (e.g. "2025-04")
     * @returns {Promise<Object>} The newly created month record
     */
    async createMonth(month) {
        return this.request('POST', '/api/month', { month });
    }

    /**
     * Adds funds (allowance) to a specific month.
     *
     * This increases the month's allowance, which affects the monthly savings
     * calculation (allowance - expenses = monthly saved). Can be called multiple
     * times to incrementally add funds.
     *
     * @param {string} month - Month key in "YYYY-MM" format to add funds to
     * @param {number} amount - Amount in dollars to add (must be positive)
     * @returns {Promise<Object>} Updated month data reflecting the new allowance
     */
    async addFunds(month, amount) {
        return this.request('POST', `/api/month/${month}/funds`, { amount });
    }
}

/** Singleton API client instance shared across the application */
export const api = new Api();
