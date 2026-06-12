/**
 * Passbook Service Worker
 *
 * Goals (review C1):
 *   - Offline support for an installed PWA: the app shell (HTML/CSS/JS/font/
 *     icon) is precached at install time so the UI paints with no network.
 *   - Instant launch: shell served stale-while-revalidate; static assets/
 *     served cache-first.
 *   - Offline dashboard: GET /api/months and /api/month/* are network-first
 *     with a cache fallback, so the last-seen dashboard repaints offline.
 *
 * Hard constraints honored here:
 *   - GitHub Pages SUBPATH: the app is served from /passbook/<instance>/.
 *     Every cache key and precache URL is resolved RELATIVE to the worker's
 *     own scope (self.registration.scope / self.location), never an absolute
 *     site-root path. So the kids and eatout instances get independent caches.
 *   - NEVER cache auth endpoints or any non-GET request. Auth responses carry
 *     session tokens / setup state and must always hit the network.
 *   - The cache name is versioned; on activate we delete every cache that
 *     isn't from the current version, scoped to this instance.
 *
 * The version is read from the sibling VERSION file at install time. CI may
 * also rewrite the SW_VERSION placeholder below at build time (see report);
 * the VERSION fetch is the robust runtime fallback when it doesn't.
 */

// CI MAY replace this token at build time (see deploy-frontend.yaml notes).
// Until then it stays a literal placeholder and the install step falls back
// to fetching the VERSION file.
const SW_VERSION_PLACEHOLDER = '__SW_VERSION__';

// Scope path, e.g. "/passbook/kids/". Everything is resolved against this so
// the worker only ever touches its own instance's URLs and caches.
const SCOPE_PATH = new URL(self.registration.scope).pathname;

// A short, stable instance tag derived from the scope so the kids and eatout
// instances never collide in the Cache Storage namespace (which is per-origin,
// shared across subpaths on vppillai.github.io).
const INSTANCE_TAG = SCOPE_PATH.replace(/\/+$/, '').split('/').filter(Boolean).pop() || 'default';

// App-shell files to precache. Relative URLs resolve against SCOPE_PATH.
// config.js and theme.css exist ONLY in the built site, so they are fetched
// defensively (a failed add must not abort the whole install).
const PRECACHE_URLS = [
    './',
    './index.html',
    './css/styles.css',
    './js/app.js',
    './js/api.js',
    './js/auth.js',
    './js/ui.js',
    './js/labels.js',
    './manifest.json',
    './assets/icon.svg',
    './assets/fonts/bricolage-grotesque-var.woff2',
];

// Build-only files: present after CI assembles the instance, absent locally.
const OPTIONAL_PRECACHE_URLS = [
    './js/config.js',
    './css/theme.css',
];

let CACHE_PREFIX = `passbook-${INSTANCE_TAG}-`;
let VERSION = SW_VERSION_PLACEHOLDER;
let SHELL_CACHE = `${CACHE_PREFIX}shell-${VERSION}`;
let ASSET_CACHE = `${CACHE_PREFIX}assets-${VERSION}`;
let API_CACHE = `${CACHE_PREFIX}api-${VERSION}`;

function setVersion(version) {
    VERSION = version;
    SHELL_CACHE = `${CACHE_PREFIX}shell-${VERSION}`;
    ASSET_CACHE = `${CACHE_PREFIX}assets-${VERSION}`;
    API_CACHE = `${CACHE_PREFIX}api-${VERSION}`;
}

/**
 * Resolves the cache version. Prefers the build-injected placeholder; falls
 * back to fetching the sibling VERSION file; finally falls back to a literal
 * so a missing VERSION file never breaks installation.
 */
async function resolveVersion() {
    if (SW_VERSION_PLACEHOLDER && SW_VERSION_PLACEHOLDER.indexOf('__') !== 0) {
        return SW_VERSION_PLACEHOLDER;
    }
    try {
        const res = await fetch(new URL('./VERSION', self.registration.scope), { cache: 'no-store' });
        if (res.ok) {
            const text = (await res.text()).trim();
            if (text) return text;
        }
    } catch {
        /* offline or no VERSION file — fall through */
    }
    return 'v0';
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        setVersion(await resolveVersion());
        const cache = await caches.open(SHELL_CACHE);
        // Required shell: addAll is atomic, so wrap so a single 404 (e.g. a
        // renamed asset) doesn't wedge the whole install.
        try {
            await cache.addAll(PRECACHE_URLS);
        } catch {
            // Fall back to best-effort individual adds.
            await Promise.all(PRECACHE_URLS.map((u) =>
                cache.add(u).catch(() => {})));
        }
        // Optional (build-only) shell files: best-effort, ignore failures.
        await Promise.all(OPTIONAL_PRECACHE_URLS.map((u) =>
            cache.add(u).catch(() => {})));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        setVersion(await resolveVersion());
        const keep = new Set([SHELL_CACHE, ASSET_CACHE, API_CACHE]);
        const names = await caches.keys();
        await Promise.all(names.map((name) => {
            // Only reap THIS instance's caches; leave sibling instances alone.
            if (name.startsWith(CACHE_PREFIX) && !keep.has(name)) {
                return caches.delete(name);
            }
            return undefined;
        }));
        await self.clients.claim();
    })());
});

/** True for GET requests whose path is under /api/. */
function isApiRequest(url) {
    return url.pathname.indexOf('/api/') !== -1;
}

/** Auth endpoints must never be cached or served from cache. */
function isAuthRequest(url) {
    return url.pathname.indexOf('/api/auth') !== -1;
}

/**
 * Only month-dashboard reads are safe to cache: GET /api/months and
 * GET /api/month/*. Everything else (balance, unknown future endpoints) goes
 * straight to the network with no caching. Matches on pathname only — the
 * query string (limit/cursor) is part of the cache key via the Request, not
 * this predicate.
 */
function isCacheableApi(url) {
    return /\/api\/months$/.test(url.pathname)
        || /\/api\/month\/[^/]+$/.test(url.pathname);
}

/** Static asset that can be safely cached-first (immutable-ish bundle files). */
function isAsset(url) {
    return /\.(?:css|js|woff2?|svg|png|webp|json)$/i.test(url.pathname)
        && url.pathname.startsWith(SCOPE_PATH);
}

/** Navigation / shell HTML request. */
function isShellNavigation(request, url) {
    return request.mode === 'navigate'
        || (request.destination === 'document' && url.pathname.startsWith(SCOPE_PATH));
}

async function networkFirstApi(request) {
    const cache = await caches.open(API_CACHE);
    try {
        const response = await fetch(request);
        // Only cache successful, basic/cors GET responses.
        if (response && response.ok) {
            cache.put(request, response.clone());
        }
        return response;
    } catch (err) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw err;
    }
}

async function cacheFirstAsset(request) {
    const cache = await caches.open(ASSET_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response && response.ok) {
        cache.put(request, response.clone());
    }
    return response;
}

async function staleWhileRevalidateShell(request) {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request) || await cache.match('./index.html');
    const network = fetch(request).then((response) => {
        if (response && response.ok) cache.put(request, response.clone());
        return response;
    }).catch(() => null);
    return cached || (await network) || fetch(request);
}

self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Never touch non-GET (mutations, auth POSTs, logout).
    if (request.method !== 'GET') return;

    let url;
    try {
        url = new URL(request.url);
    } catch {
        return;
    }

    // API requests (cross-origin to the execute-api host).
    if (isApiRequest(url)) {
        // Auth is always network-only — never cache, never serve from cache.
        if (isAuthRequest(url)) return;
        if (isCacheableApi(url)) {
            event.respondWith(networkFirstApi(request));
        }
        // Other API GETs (e.g. /api/balance): leave to the network untouched.
        return;
    }

    // Same-origin app shell + assets only.
    if (url.origin !== self.location.origin) return;

    if (isShellNavigation(request, url)) {
        event.respondWith(staleWhileRevalidateShell(request));
        return;
    }

    if (isAsset(url)) {
        event.respondWith(cacheFirstAsset(request));
    }
});
