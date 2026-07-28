/**
 * WebAuthn (biometric unlock) helpers.
 *
 * Wraps navigator.credentials.create/get with the base64url <-> ArrayBuffer
 * conversion the server's JSON contract needs, plus feature detection. The
 * server (go-webauthn) emits and consumes the standard WebAuthn JSON shapes:
 * binary fields (challenge, user.id, credential id, allowCredentials[].id)
 * are base64url strings on the wire and ArrayBuffers in the browser API.
 *
 * Transport is api.js's shared client. This module used to carry its own copy
 * of it — API base, 15s timeout, instance detection, session-key derivation
 * and fetch/error shaping all duplicated — on the stated grounds of staying "in
 * lockstep without coupling". Duplication does the opposite: the copy read the
 * session token without api.js's expiry check, so it would send a token
 * api.js already considered dead.
 *
 * The one thing that genuinely required a separate client was api.js clearing
 * the session on any 401; these endpoints return 401 for a failed assertion,
 * which must surface as "biometric unlock failed" rather than bouncing the user
 * to the lock screen. That is now handled by listing /api/auth/webauthn in
 * api.js's AUTH_ENDPOINTS, so the bypass is declared in one place instead of
 * being achieved by avoiding the module.
 *
 * @module webauthn
 */

import { api } from './api.js';

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

/**
 * Fetches /api/auth/status and returns the parsed body, including the
 * webauthn_enrolled flag the lock screen needs. Public (no auth). Resolves
 * null on any error so a status failure never blocks the PIN path.
 * @returns {Promise<{is_setup?: boolean, webauthn_enrolled?: boolean}|null>}
 */
export async function getAuthStatus() {
    // Deliberately total: callers use this to decide whether to SHOW a control,
    // and a status hiccup must not throw into that path. api.request rejects on
    // failure, so the swallow stays here.
    try {
        return await api.request('GET', '/api/auth/status');
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
    const options = await api.request('POST', '/api/auth/webauthn/register/options');
    const publicKey = decodeCreationOptions(options.options.publicKey);

    const cred = await navigator.credentials.create({ publicKey });
    if (!cred) throw new Error('No credential created');

    await api.request('POST', '/api/auth/webauthn/register', {
        challenge_id: options.challenge_id,
        credential: encodeRegistrationCredential(cred),
    });
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
    const options = await api.request('POST', '/api/auth/webauthn/login/options');
    const publicKey = decodeRequestOptions(options.options.publicKey);

    const cred = await navigator.credentials.get({ publicKey });
    if (!cred) throw new Error('No assertion produced');

    return api.request('POST', '/api/auth/webauthn/login', {
        challenge_id: options.challenge_id,
        credential: encodeAssertionCredential(cred),
    });
}

/**
 * Disables biometric unlock by removing all stored credentials (session-gated
 * DELETE). Resolves on success; rejects with an Error otherwise.
 * @returns {Promise<void>}
 */
export async function disable() {
    await api.request('DELETE', '/api/auth/webauthn');
}
