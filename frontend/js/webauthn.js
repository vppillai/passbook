/**
 * WebAuthn (biometric unlock) helpers.
 *
 * Wraps navigator.credentials.create/get with the base64url <-> ArrayBuffer
 * conversion the server's JSON contract needs, plus feature detection. The
 * server (go-webauthn) emits and consumes the standard WebAuthn JSON shapes:
 * binary fields (challenge, user.id, credential id, allowCredentials[].id)
 * are base64url strings on the wire and ArrayBuffers in the browser API.
 *
 * SHARED CONTRACT: this module does NOT import api.js. It issues raw fetch
 * calls using the SAME conventions api.js uses — API base from
 * window.PASSBOOK_API_URL and the per-instance X-Session-Token from
 * localStorage — mirrored here so the two stay in lockstep without coupling.
 *
 * @module webauthn
 */

// Mirror api.js exactly: API base is injected at build time, empty for local.
const API_BASE = window.PASSBOOK_API_URL || '';

// Network request timeout (mirrors api.js): long enough for an API GW cold
// start, short enough to fail visibly rather than hang on a flaky connection.
const REQUEST_TIMEOUT_MS = 15000;

// Mirror api.js's per-instance session key derivation. The app is served from
// /passbook/<instance>/ on GitHub Pages; the instance segment namespaces the
// token so co-hosted instances don't clobber each other.
function detectInstance() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[0] === 'passbook') return parts[1];
    return parts[parts.length - 1] || 'default';
}
const SESSION_KEY = `passbook_session_${detectInstance()}`;

/**
 * Reads the current session token from localStorage (same key api.js writes).
 * Returns null when absent. Used to attach X-Session-Token on the
 * session-gated register endpoints.
 * @returns {string|null}
 */
function sessionToken() {
    return localStorage.getItem(SESSION_KEY) || null;
}

/**
 * Feature-detects the WebAuthn API. False on browsers/contexts (e.g. http://)
 * where PublicKeyCredential is unavailable.
 * @returns {boolean}
 */
export function isWebAuthnSupported() {
    return typeof window !== 'undefined' &&
        typeof window.PublicKeyCredential === 'function' &&
        !!(navigator.credentials && navigator.credentials.create && navigator.credentials.get);
}

/**
 * Reports whether a platform authenticator (Face ID / Touch ID / Windows
 * Hello) is available, via isUserVerifyingPlatformAuthenticatorAvailable.
 * Resolves false (never rejects) when unsupported or on any error, so callers
 * can treat it as a plain boolean gate.
 * @returns {Promise<boolean>}
 */
export async function isPlatformAuthenticatorAvailable() {
    if (!isWebAuthnSupported() ||
        typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') {
        return false;
    }
    try {
        return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
        return false;
    }
}

// ---- base64url <-> ArrayBuffer conversions ----

/**
 * Decodes a base64url string to an ArrayBuffer. Tolerates missing padding and
 * the URL-safe alphabet that the server emits.
 * @param {string} value
 * @returns {ArrayBuffer}
 */
export function base64urlToBuffer(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

/**
 * Encodes an ArrayBuffer (or ArrayBufferView) to an unpadded base64url string,
 * the shape the server expects for credential responses.
 * @param {ArrayBuffer|ArrayBufferView} buffer
 * @returns {string}
 */
export function bufferToBase64url(buffer) {
    const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---- options decode: server JSON -> CredentialCreation/RequestOptions IDL ----

/**
 * Converts the server's creation-options JSON (binary fields as base64url)
 * into the PublicKeyCredentialCreationOptions object navigator.credentials
 * .create expects (binary fields as ArrayBuffers).
 * @param {Object} publicKey - the `publicKey` member of the server options
 * @returns {Object}
 */
function decodeCreationOptions(publicKey) {
    const out = { ...publicKey };
    out.challenge = base64urlToBuffer(publicKey.challenge);
    out.user = { ...publicKey.user, id: base64urlToBuffer(publicKey.user.id) };
    if (Array.isArray(publicKey.excludeCredentials)) {
        out.excludeCredentials = publicKey.excludeCredentials.map(c => ({
            ...c,
            id: base64urlToBuffer(c.id),
        }));
    }
    return out;
}

/**
 * Converts the server's request-options JSON into the
 * PublicKeyCredentialRequestOptions object navigator.credentials.get expects.
 * @param {Object} publicKey - the `publicKey` member of the server options
 * @returns {Object}
 */
function decodeRequestOptions(publicKey) {
    const out = { ...publicKey };
    out.challenge = base64urlToBuffer(publicKey.challenge);
    if (Array.isArray(publicKey.allowCredentials)) {
        out.allowCredentials = publicKey.allowCredentials.map(c => ({
            ...c,
            id: base64urlToBuffer(c.id),
        }));
    }
    return out;
}

// ---- credential encode: PublicKeyCredential -> server JSON ----

/**
 * Serializes a registration PublicKeyCredential into the JSON shape
 * go-webauthn's ParseCredentialCreationResponse expects.
 * @param {PublicKeyCredential} cred
 * @returns {Object}
 */
function encodeRegistrationCredential(cred) {
    const r = cred.response;
    const json = {
        id: cred.id,
        rawId: bufferToBase64url(cred.rawId),
        type: cred.type,
        clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
        response: {
            clientDataJSON: bufferToBase64url(r.clientDataJSON),
            attestationObject: bufferToBase64url(r.attestationObject),
        },
    };
    if (typeof r.getTransports === 'function') {
        json.response.transports = r.getTransports();
    }
    if (cred.authenticatorAttachment) json.authenticatorAttachment = cred.authenticatorAttachment;
    return json;
}

/**
 * Serializes an assertion PublicKeyCredential into the JSON shape
 * go-webauthn's ParseCredentialRequestResponse expects.
 * @param {PublicKeyCredential} cred
 * @returns {Object}
 */
function encodeAssertionCredential(cred) {
    const r = cred.response;
    const json = {
        id: cred.id,
        rawId: bufferToBase64url(cred.rawId),
        type: cred.type,
        clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
        response: {
            clientDataJSON: bufferToBase64url(r.clientDataJSON),
            authenticatorData: bufferToBase64url(r.authenticatorData),
            signature: bufferToBase64url(r.signature),
            userHandle: r.userHandle ? bufferToBase64url(r.userHandle) : null,
        },
    };
    if (cred.authenticatorAttachment) json.authenticatorAttachment = cred.authenticatorAttachment;
    return json;
}

// ---- raw fetch (no api.js) ----

/**
 * Issues a JSON fetch against the API, mirroring api.js's conventions:
 * API_BASE prefix, Content-Type: application/json, X-Session-Token attached
 * when withAuth and a token exists, credentials omitted, 15s timeout.
 * Returns the parsed JSON body (or null). Throws an Error carrying .status and
 * .responseData on a non-2xx response so callers can branch on it.
 * @param {string} endpoint
 * @param {Object|null} body
 * @param {boolean} withAuth
 * @returns {Promise<Object|null>}
 */
async function apiPost(endpoint, body, withAuth) {
    const headers = { 'Content-Type': 'application/json' };
    if (withAuth) {
        const token = sessionToken();
        if (token) headers['X-Session-Token'] = token;
    }
    let response;
    try {
        response = await fetch(`${API_BASE}${endpoint}`, {
            method: 'POST',
            headers,
            credentials: 'omit',
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (err) {
        if (err.name === 'TimeoutError' || err.name === 'AbortError') {
            throw new Error('Request timed out. Check your connection and try again.');
        }
        throw err;
    }

    let data = null;
    if (response.status !== 204) {
        const text = await response.text();
        if (text) {
            try { data = JSON.parse(text); } catch { /* leave null */ }
        }
    }
    if (!response.ok) {
        const err = new Error((data && data.error) || `Request failed (HTTP ${response.status})`);
        err.status = response.status;
        err.responseData = data;
        if (data && data.retry_after_seconds !== undefined) err.retry_after_seconds = data.retry_after_seconds;
        throw err;
    }
    return data;
}

/**
 * Fetches /api/auth/status and returns the parsed body, including the
 * webauthn_enrolled flag the lock screen needs. Public (no auth). Resolves
 * null on any error so a status failure never blocks the PIN path.
 * @returns {Promise<{is_setup?: boolean, webauthn_enrolled?: boolean}|null>}
 */
export async function getAuthStatus() {
    try {
        const response = await fetch(`${API_BASE}/api/auth/status`, {
            method: 'GET',
            credentials: 'omit',
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    }
}

// ---- ceremonies ----

/**
 * Runs the registration ceremony: fetch creation options (session-gated),
 * call navigator.credentials.create, post the attestation back for
 * verification. Resolves on success; rejects with an Error otherwise (e.g.
 * the user dismissed the biometric prompt → NotAllowedError).
 * @returns {Promise<void>}
 */
export async function register() {
    const options = await apiPost('/api/auth/webauthn/register/options', null, true);
    const publicKey = decodeCreationOptions(options.options.publicKey);

    const cred = await navigator.credentials.create({ publicKey });
    if (!cred) throw new Error('No credential created');

    await apiPost('/api/auth/webauthn/register', {
        challenge_id: options.challenge_id,
        credential: encodeRegistrationCredential(cred),
    }, true);
}

/**
 * Runs the userless login ceremony: fetch request options (public), call
 * navigator.credentials.get, post the assertion back. On success the server
 * mints a session and returns the same body as PIN verify ({success, token});
 * this resolves to that object so the caller can store the token exactly like
 * a PIN login. Rejects with an Error (carrying .status / .retry_after_seconds)
 * on failure.
 * @returns {Promise<{success: boolean, token?: string, error?: string}>}
 */
export async function login() {
    const options = await apiPost('/api/auth/webauthn/login/options', null, false);
    const publicKey = decodeRequestOptions(options.options.publicKey);

    const cred = await navigator.credentials.get({ publicKey });
    if (!cred) throw new Error('No assertion produced');

    return apiPost('/api/auth/webauthn/login', {
        challenge_id: options.challenge_id,
        credential: encodeAssertionCredential(cred),
    }, false);
}

/**
 * Disables biometric unlock by removing all stored credentials (session-gated
 * DELETE). Resolves on success; rejects with an Error otherwise.
 * @returns {Promise<void>}
 */
export async function disable() {
    const token = sessionToken();
    const headers = {};
    if (token) headers['X-Session-Token'] = token;
    const response = await fetch(`${API_BASE}/api/auth/webauthn`, {
        method: 'DELETE',
        headers,
        credentials: 'omit',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
        throw new Error(`Failed to disable biometric unlock (HTTP ${response.status})`);
    }
}
