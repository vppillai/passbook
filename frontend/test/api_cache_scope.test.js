import { test, expect, describe } from 'bun:test';
import { isOwnApiCacheName } from '../js/api.js';

// Cache Storage is per-ORIGIN, and both deployments live on the same origin
// (vppillai.github.io/passbook/kids/ and /eatout/). The service worker is careful
// about that: its activate reaper says "only reap THIS instance's caches" and its
// PURGE_API_CACHE handler filters on the instance-scoped prefix.
//
// The page-side purge was not. It matched any name containing '-api-' that
// started with 'passbook-', so locking out of one instance also wiped the
// other's cached API responses — the sibling app silently lost its offline data
// until it next reached the network. Not a data leak (same user either way), but
// the page and the worker disagreed about scope, and the page was the one that
// was wrong.
//
// test/setup.js serves the suite from https://example.github.io/passbook/kids/,
// so 'kids' is THIS instance here and 'eatout' is the sibling that used to get
// caught in the blast.
describe('logout cache purge scope', () => {
    test("matches this instance's api caches", () => {
        expect(isOwnApiCacheName('passbook-kids-api-v2.7.0')).toBe(true);
        // A previous version's copy holds the same private data, so it must go
        // too — the worker deletes by prefix for that reason.
        expect(isOwnApiCacheName('passbook-kids-api-v2.6.0-abc1234')).toBe(true);
    });

    test("leaves a sibling instance's api cache alone", () => {
        expect(isOwnApiCacheName('passbook-eatout-api-v2.7.0')).toBe(false);
        // 'default' is what both the page and the worker derive when served from
        // the root, i.e. local development.
        expect(isOwnApiCacheName('passbook-default-api-v2.7.0')).toBe(false);
    });

    test("leaves shell and asset caches alone, even this instance's", () => {
        // Only API responses carry the user's figures; evicting the shell would
        // just cost them their offline app for no privacy gain.
        expect(isOwnApiCacheName('passbook-kids-shell-v2.7.0')).toBe(false);
        expect(isOwnApiCacheName('passbook-kids-assets-v2.7.0')).toBe(false);
    });

    test('leaves unrelated caches on the origin alone', () => {
        expect(isOwnApiCacheName('some-other-app-api-v1')).toBe(false);
        expect(isOwnApiCacheName('workbox-precache')).toBe(false);
        expect(isOwnApiCacheName('')).toBe(false);
    });

    test('is not fooled by the instance name appearing elsewhere', () => {
        // The old predicate was a substring test, which is how it caught
        // siblings in the first place.
        expect(isOwnApiCacheName('passbook-kidsish-api-v1')).toBe(false);
        expect(isOwnApiCacheName('prefix-passbook-kids-api-v1')).toBe(false);
    });

    test('the old substring predicate would have caught the sibling', () => {
        // Pins what was actually wrong, so a future "simplification" back to a
        // substring test fails here rather than silently in production.
        const oldPredicate = (n) => n.indexOf('-api-') !== -1 && n.startsWith('passbook-');
        expect(oldPredicate('passbook-eatout-api-v2.7.0')).toBe(true);
        expect(isOwnApiCacheName('passbook-eatout-api-v2.7.0')).toBe(false);
    });
});
