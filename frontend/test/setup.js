// Bun test preload: install a DOM before any app module is imported.
//
// The app modules are not import-safe without one — api.js reads
// window.location.pathname and localStorage at module scope to derive its
// per-instance session key, and ui.js/labels.js read window.PASSBOOK_LABELS.
// Registering happy-dom globally here lets the tests import the real
// modules rather than re-implementing their logic.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({
    // Match the GitHub Pages layout the instance detection expects:
    // https://<owner>.github.io/passbook/<instance>/
    url: 'https://example.github.io/passbook/kids/',
});
