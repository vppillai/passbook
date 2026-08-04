import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';

// happy-dom has no layout engine, so none of this can be asserted by rendering —
// that blind spot is how the offsetParent focus-trap bug reached production
// earlier. These assert the stylesheet text instead, the same way
// ui_months.test.js pins the spend-bar tokens.
const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
const ruleFor = (selector) => {
    const at = css.indexOf(`${selector} {`);
    return at === -1 ? null : css.slice(at, css.indexOf('}', at));
};

describe('lock screen layout', () => {
    test('the pad is no longer centred mid-screen', () => {
        // justify-content:center put the keys in the middle of a tall phone,
        // above the natural thumb arc.
        expect(ruleFor('.pin-container')).not.toContain('justify-content: center');
    });

    test('keys are fluid, not a fixed 72px', () => {
        // 3x72 + 2x14 = 244px inside a 280px pad, so the declared gaps were not
        // the real ones and the pad never grew on a larger phone.
        const rule = ruleFor('.pin-key');
        expect(rule).not.toMatch(/width:\s*72px/);
        expect(rule).toContain('aspect-ratio: 1');
    });

    test('the pad may grow past its old 280px cap', () => {
        const rule = ruleFor('.pin-pad');
        expect(rule).not.toMatch(/max-width:\s*280px/);
    });

    test('an empty biometric slot costs no height', () => {
        const empty = ruleFor('#biometric-slot');
        expect(empty).not.toBeNull();
        expect(ruleFor('#biometric-slot.filled')).not.toBeNull();
    });

    test('a short viewport has a rule to fall back to', () => {
        // The only media queries were min-width:768px, prefers-color-scheme and
        // prefers-reduced-motion, so landscape had nothing at all.
        expect(css).toMatch(/@media\s*\([^)]*max-height:/);
    });
});

describe('lock screen key surface', () => {
    test('keys no longer depend on a shadow dark mode erases', () => {
        // In dark mode --surface is color-mix(accent 5%, #14171d) — almost the
        // page background — and the shadow is rgba(0,0,0,...) against near-black,
        // so the keys measured 1.05-1.10:1 against the page.
        const rule = ruleFor('.pin-key');
        expect(rule).not.toContain('box-shadow: var(--shadow)');
        expect(rule).toContain('var(--key-face)');
    });

    test('the key face is derived per instance and re-derived for dark', () => {
        expect(css.split('--key-face:').length - 1).toBe(2);
        const dark = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
        expect(dark).toContain('--key-face:');
    });

    test('the focus ring has its own token, not the raw accent', () => {
        // outline: 2px solid var(--accent) measured ~2.9:1 on eatout. Unlike the
        // key face this one IS required to reach 3:1, and is achievable.
        expect(css).toContain('--focus-ring');
        expect(ruleFor(':focus-visible')).toContain('var(--focus-ring)');
        const dark = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
        expect(dark).toContain('--focus-ring:');
    });

    test('measured ratios are recorded next to the tokens', () => {
        // A future reader must not have to re-derive them.
        const at = css.indexOf('--key-face:');
        expect(css.slice(Math.max(0, at - 1400), at)).toMatch(/Measured/);
    });
});

// auth.js sets className = 'btn-biometric'. When that class was introduced no
// rule existed for it, so the fastest way into the app rendered as an unstyled
// <button> — invisible as an affordance and impossible to catch, because no test
// looked at it and happy-dom cannot see styling at all.
describe('biometric button styling', () => {
    test('the class auth.js applies actually has a rule', () => {
        expect(ruleFor('.btn-biometric')).not.toBeNull();
    });

    test('it is a full-width action, not an inline button', () => {
        // The design puts it directly above the pad as the primary way in.
        expect(ruleFor('.btn-biometric')).toContain('width: 100%');
    });

    test('its ink is scheme-aware, since it sits on a tinted fill', () => {
        expect(css.split('--biometric-ink:').length - 1).toBe(2);
        const dark = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
        expect(dark).toContain('--biometric-ink:');
    });

    test('measured ratios are recorded beside it', () => {
        const at = css.indexOf('.btn-biometric {');
        expect(css.slice(Math.max(0, at - 900), at)).toMatch(/Measured/);
    });
});

// The pad now occupies the bottom of the viewport, where .toast has always sat
// (position:fixed; bottom:100px). That was clear of the old centred pad; it now
// lands on the bottom key row. Found by rendering the page in a real browser —
// happy-dom cannot see it, since there is no layout.
//
// It matters beyond occlusion: the service-worker update toast carries a Reload
// action, so an interactive element overlapping tappable keys risks a mis-tap.
describe('toast does not cover the keypad', () => {
    test('the toast is repositioned while a PIN screen is up', () => {
        expect(css).toMatch(/#auth-screen:not\(\.hidden\)\)? \.toast|\.toast[^{]*auth-screen/);
    });

    test('it moves to the top rather than being nudged up the pad', () => {
        // Nudging leaves it over some other key at a different key size; the top
        // of the lock screen is empty by construction.
        const at = css.indexOf('#auth-screen:not(.hidden)');
        const rule = css.slice(at, css.indexOf('}', at));
        expect(rule).toContain('bottom: auto');
        expect(rule).toMatch(/top:/);
    });

    test('it respects the top safe area', () => {
        const at = css.indexOf('#auth-screen:not(.hidden)');
        expect(css.slice(at, css.indexOf('}', at))).toContain('safe-area-inset-top');
    });
});

// The filled slot originally carried margin-bottom only, and .pin-display carries
// margin-top only, so a rendered biometric button butted against the dots at
// roughly 10px where the rest of the screen uses 16-24px. Only visible once the
// button was actually on screen — happy-dom has no layout, and the offline
// status call removes the primed button, so it took forcing it visible in a real
// browser to see.
describe('biometric slot spacing', () => {
    test('a filled slot is separated from the dots above it, not just the pad below', () => {
        const rule = ruleFor('#biometric-slot.filled');
        expect(rule).not.toBeNull();
        expect(rule).toMatch(/margin-top:|margin:\s*var/);
    });

    test('an empty slot still costs no vertical space', () => {
        // The whole point of the reserved slot is that filling it moves nothing;
        // an unconditional margin would reintroduce a gap on every device
        // without biometrics.
        const empty = ruleFor('#biometric-slot');
        expect(empty).not.toMatch(/margin/);
    });
});

// Landscape was clipping the bottom two key rows. The first short-viewport rule
// only compressed the identity band, on the stated reasoning that "the pad keeps
// its size because it is what the user is aiming at" — which is wrong when four
// rows of square keys exceed the viewport height on their own (~458px of keys in
// a 390px-tall window). Caught by rendering at 780x390, not by any test.
describe('short viewport fits the whole pad', () => {
    test('the pad is bounded by viewport HEIGHT, not just width', () => {
        // Keys are aspect-ratio:1 in 1fr columns, so their height follows the
        // pad's width — bounding the width by available height is what makes all
        // four rows fit.
        const at = css.indexOf('@media (max-height: 620px)');
        expect(at).toBeGreaterThan(-1);
        const block = css.slice(at, css.indexOf('\n}', css.indexOf('.pin-pad', at)));
        expect(block).toMatch(/dvh|vh/);
    });

    test('the screen can scroll as a backstop', () => {
        // Belt and braces: whatever the viewport, nothing may end up unreachable.
        // Scoped to the media block's real extent rather than a character count,
        // which a long comment silently pushed the match outside of.
        const at = css.indexOf('@media (max-height: 620px)');
        const block = css.slice(at, css.indexOf('\n}', css.indexOf('.screen {', at)));
        expect(block).toMatch(/overflow-y:\s*auto/);
    });
});

// The letters sat on a white key face before v2.10.0 and now sit on an accent
// tint, where --ink-3 measures 2.04-3.01:1 — well under the 4.5:1 that 0.55rem
// text needs, since it is nowhere near large-text size.
describe('T9 letter contrast on the tinted key face', () => {
    test('letters do not use the faintest ink', () => {
        expect(ruleFor('.key-letters')).not.toContain('var(--ink-3)');
    });

    test('measured ratios are recorded beside them', () => {
        const at = css.indexOf('.key-letters {');
        expect(css.slice(at, css.indexOf('}', at))).toMatch(/4\.90|Measured|measures/);
    });
});
