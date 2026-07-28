import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { api } from '../js/api.js';

// api.request treats a 401 as "your session died" and clears it, EXCEPT on the
// endpoints listed in AUTH_ENDPOINTS, where a 401 is a real answer about the
// credential just supplied. The WebAuthn endpoints belong in that list: a failed
// biometric assertion returns 401 and must surface as "biometric unlock failed",
// not log the user out.
//
// This is the behaviour webauthn.js used to guarantee by carrying its own copy
// of the fetch client. Consolidating onto api.request only stays correct as long
// as the bypass holds, so it is pinned here.
describe('401 handling per endpoint', () => {
    const realFetch = globalThis.fetch;
    let expiredEvents;

    const onExpired = () => { expiredEvents += 1; };

    beforeEach(() => {
        expiredEvents = 0;
        window.addEventListener('session-expired', onExpired);
        api.setSession('tok-abc');
    });

    afterEach(() => {
        window.removeEventListener('session-expired', onExpired);
        globalThis.fetch = realFetch;
        api.clearSession();
    });

    /** Stubs fetch with a fixed status and JSON body. */
    const stub = (status, body) => {
        globalThis.fetch = async () => ({
            status,
            ok: status >= 200 && status < 300,
            headers: { get: () => null },
            text: async () => JSON.stringify(body),
        });
    };

    const webauthnPaths = [
        '/api/auth/webauthn/login',
        '/api/auth/webauthn/login/options',
        '/api/auth/webauthn/register',
        '/api/auth/webauthn/register/options',
        '/api/auth/webauthn',
    ];

    for (const path of webauthnPaths) {
        test(`401 from ${path} keeps the session`, async () => {
            stub(401, { error: 'Could not verify the authenticator' });
            let caught;
            try {
                await api.request('POST', path);
            } catch (e) {
                caught = e;
            }
            expect(caught).toBeDefined();
            expect(caught.status).toBe(401);
            expect(caught.responseData.error).toBe('Could not verify the authenticator');
            expect(api.sessionToken).toBe('tok-abc');
            expect(expiredEvents).toBe(0);
        });
    }

    test('429 from the biometric login surfaces retry_after_seconds', async () => {
        stub(429, { error: 'Too many attempts. Please wait.', retry_after_seconds: 412 });
        let caught;
        try {
            await api.request('POST', '/api/auth/webauthn/login');
        } catch (e) {
            caught = e;
        }
        expect(caught.status).toBe(429);
        expect(caught.retry_after_seconds).toBe(412);
        expect(api.sessionToken).toBe('tok-abc');
        expect(expiredEvents).toBe(0);
    });

    test('401 from a DATA endpoint still clears the session and fires the event', async () => {
        stub(401, { error: 'Unauthorized' });
        let caught;
        try {
            await api.request('GET', '/api/balance');
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeDefined();
        expect(api.sessionToken).toBeNull();
        expect(expiredEvents).toBe(1);
    });

    test('401 from PIN verify keeps the session (unchanged behaviour)', async () => {
        stub(401, { error: 'Invalid PIN', attempts_remaining: 3 });
        let caught;
        try {
            await api.request('POST', '/api/auth/verify');
        } catch (e) {
            caught = e;
        }
        expect(caught.status).toBe(401);
        expect(caught.attempts_remaining).toBe(3);
        expect(api.sessionToken).toBe('tok-abc');
        expect(expiredEvents).toBe(0);
    });
});
