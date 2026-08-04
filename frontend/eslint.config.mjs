// ESLint flat config for the Passbook PWA.
//
// The app ships as plain ES modules with no build step, so there is no bundler
// or type checker in front of it — CI previously ran only `node --check`, which
// catches syntax errors and nothing else. An unused variable, a typo'd
// identifier, an accidental global or a shadowed binding all reached production
// silently. These rules are deliberately narrow: correctness signals, not style
// preferences, because reformatting an existing codebase generates noise that
// buries the real findings.
import js from '@eslint/js';

/** Globals available to browser code (the app targets browsers only). */
const browserGlobals = {
    window: 'readonly',
    document: 'readonly',
    navigator: 'readonly',
    localStorage: 'readonly',
    fetch: 'readonly',
    Request: 'readonly',
    Response: 'readonly',
    Headers: 'readonly',
    URL: 'readonly',
    AbortSignal: 'readonly',
    Intl: 'readonly',
    caches: 'readonly',
    console: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    clearInterval: 'readonly',
    atob: 'readonly',
    btoa: 'readonly',
    Uint8Array: 'readonly',
    ArrayBuffer: 'readonly',
    CustomEvent: 'readonly',
    KeyboardEvent: 'readonly',
    MutationObserver: 'readonly',
    PublicKeyCredential: 'readonly',
    TextEncoder: 'readonly',
    TextDecoder: 'readonly',
};

/** Additional globals inside a ServiceWorkerGlobalScope. */
const serviceWorkerGlobals = {
    ...browserGlobals,
    self: 'readonly',
    clients: 'readonly',
    skipWaiting: 'readonly',
    registration: 'readonly',
};

const correctnessRules = {
    // Unused code is either a leftover or a bug (a variable computed and then
    // not used usually means the use was meant to happen).
    'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
    }],
    // The single highest-value rule here: catches a typo'd identifier, which in
    // a no-build-step codebase is otherwise a runtime ReferenceError in a
    // branch nobody exercised.
    'no-undef': 'error',
    // Assigning to an undeclared name creates a global; in modules it throws.
    'no-implicit-globals': 'error',
    // A shadowed binding in this codebase's nested callbacks reads as the outer
    // one and silently is not.
    'no-shadow': 'warn',
    // `==` against null/undefined is the only sane use; everything else hides
    // coercion bugs around amounts and ids.
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    // Fall-through and duplicate keys/cases are always mistakes.
    'no-fallthrough': 'error',
    'no-duplicate-case': 'error',
    'no-dupe-keys': 'error',
    // An empty catch is how the app deliberately ignores unsupported APIs, so
    // allow it there but nowhere else.
    'no-empty': ['error', { allowEmptyCatch: true }],
    // Promise mistakes that silently swallow failures.
    'require-atomic-updates': 'off',
    'no-async-promise-executor': 'error',
    'no-await-in-loop': 'off',
    // Comparing against NaN with === is always false.
    'use-isnan': 'error',
    'valid-typeof': 'error',
};

export default [
    { ignores: ['node_modules/**', 'js/config.js'] },
    js.configs.recommended,
    {
        files: ['js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: browserGlobals,
        },
        rules: correctnessRules,
    },
    {
        files: ['sw.js'],
        languageOptions: {
            ecmaVersion: 2023,
            // The worker is a classic script, not a module.
            sourceType: 'script',
            globals: serviceWorkerGlobals,
        },
        rules: {
            ...correctnessRules,
            // A classic service-worker script has no module scope, so its
            // top-level helpers ARE globals by design — that is how a worker is
            // written. The rule is aimed at scripts that pollute a shared
            // window; there is nothing to collide with inside a dedicated
            // worker scope.
            'no-implicit-globals': 'off',
        },
    },
    {
        files: ['test/**/*.js', 'eslint.config.mjs'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: {
                ...browserGlobals,
                Bun: 'readonly',
                process: 'readonly',
                // Test-only, deliberately NOT added to browserGlobals: the app
                // itself never parses HTML or reads Node constants, so declaring
                // them for app code would weaken no-undef — a typo'd `Node`
                // there should still be caught. index_markup.test.js needs them
                // to parse index.html as a document, which is the only way to
                // assert structure (parent/sibling) rather than mere presence.
                DOMParser: 'readonly',
                Node: 'readonly',
            },
        },
        rules: {
            ...correctnessRules,
            // Tests reach into happy-dom internals on purpose (counting event
            // listeners is the only way to observe a listener leak).
            'no-shadow': 'off',
        },
    },
];
