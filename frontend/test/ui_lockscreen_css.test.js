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
