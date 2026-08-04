# Lock Screen — Design

Date: 2026-07-29
Status: implemented on branch `feat/lock-screen` (see Deviations)

## Goal

Make the PIN screen faster to use and better looking, and fix its layout. It is
the first thing anyone sees and it is used several times a day, so friction there
is paid repeatedly.

Two screens share every class involved (`.pin-container`, `.pin-display`,
`.pin-pad`, `.pin-key`): `#auth-screen` (unlock) and `#setup-screen` (first-run
PIN creation). Styling changes therefore land on both whether or not we intend
it; behavioural changes must be scoped deliberately.

## Problems, as measured

1. **Every unlock costs an extra deliberate tap.** There is no auto-submit —
   digits are entered, then `OK` must be found and pressed. Not an oversight: the
   PIN is 4–6 digits and the client has no idea which, because
   `/api/auth/status` returns only `is_setup` and `webauthn_enrolled`.

2. **The biometric button shifts the layout, exactly where the user is about to
   tap.** `auth.js` injects it *above* the pad only after `getAuthStatus()` and
   `isPlatformAuthenticatorAvailable()` both resolve, so the pad paints first and
   is then pushed down. It is also styled `btn btn-outline btn-full`, chosen
   because it needed no new CSS — so the fastest path looks like the secondary
   one.

3. **The pad does not fit its own grid, and never grows.** Keys are a fixed
   `72px` inside `grid-template-columns: repeat(3, 1fr)` on a `280px` pad:
   3×72 + 2×14 = 244px, leaving 36px of slack distributed into the columns. Real
   gaps are therefore wider than the declared 14px, and the pad is 280px on a
   320px handset and still 280px on a 430px one.

4. **The pad sits mid-screen, above the thumb.** `.pin-container` is
   `justify-content: center`, so on a tall phone the keys land in the middle
   rather than in the natural thumb arc.

5. **Six dots always show**, even for a 4-digit PIN, so nothing indicates how
   many digits are expected.

6. **No short-viewport handling exists.** The only media queries in the
   stylesheet are `min-width: 768px`, `prefers-color-scheme` and
   `prefers-reduced-motion`. In landscape the centred stack has no fallback.

7. **Keys are defined entirely by shadow, which dark mode erases.**
   `background: var(--surface)` + `box-shadow`. In dark mode `--surface` is
   `color-mix(accent 5%, #14171d)` — almost the page background — and the shadow
   is `rgba(0,0,0,…)` against near-black. Measured key-vs-page: **1.05–1.07:1
   light, 1.10:1 dark**.

8. The pad carries `ABC`/`DEF` dialler letters, meaningless for a numeric PIN.

Checked and found NOT to be problems, to save re-investigation:

- `env(safe-area-inset-bottom)` **is** already applied via `.screen`, so a
  bottom-anchored pad will not collide with the home indicator.
- `updatePinDisplay(containerId, …)` accepts either a screen id or a display id
  (`#id .pin-display` with a fallback to `#id`), so the inconsistent call sites
  in `auth.js` — `'setup-screen'` vs `'auth-pin-display'` — both work.

## Decisions

### Layout: thumb-first

`.pin-container` becomes three vertical bands:

```
┌──────────────────────┐
│                      │  identity band  (flex: 1, centred)
│      [ mark ]        │    · app mark
│    My Passbook       │    · title
│    Enter your PIN     │    · sub-message
│      ● ● ● ○         │    · dots (count = real PIN length)
│                      │
├──────────────────────┤
│  Unlock with Face ID │  biometric slot (reserved, see below)
├──────────────────────┤
│   1     2     3      │  pad, pinned to the bottom
│   4     5     6      │    · aspect-ratio: 1, repeat(3, 1fr)
│   7     8     9      │    · fills available width
│   ←     0     ✕      │
└──────────────────────┘
```

The pad is pinned to the bottom of the flex column, inside `.screen`'s existing
safe-area padding, so the keys fall in the thumb arc. Keys drop their fixed width
for `aspect-ratio: 1`, so the grid is honoured exactly and the pad scales with
the viewport. Pad gains a `max-width` of roughly 360px — up from today's 280px, so it
grows on a large phone without becoming absurd on a tablet — and the existing
`min-width: 768px` block centres it. The exact value is tuned on a device; what
matters is that it is no longer the binding constraint on a 390px+ handset.

The identity mark is the **existing PWA icon** — `assets/icons/<instance>.svg`
when present, else `assets/icon.svg`. Already per-instance, already shipped, so
nothing new is invented or needs designing.

### Keys: tinted wash, not elevation

Face becomes `color-mix(in srgb, var(--accent) 16%, transparent)` (dark: 20%),
with the shadow removed. Pressed state deepens the tint and scales, replacing the
current `background: var(--surface-2)`.

This was chosen against a measured alternative, and the reasoning must survive:

Figures are for both instances, so each cell is a range across `kids` and
`eatout`:

| | key-vs-page (light) | key-vs-page (dark) | numeral-on-key |
|---|---|---|---|
| today (white + shadow) | 1.05–1.07 | 1.10 | — |
| tinted wash 16% / 20% | **1.17–1.19** | **1.28–1.33** | **11.7–14.0** |
| neutral face at 3:1 | 3.00 | 3.00 | 5.0–5.3 |

**No treatment reaches a 3:1 key boundary with this palette.** Two hard
constraints establish that:

- `eatout`'s accent `#E07856` cannot reach 3:1 against its own light background
  `#FFF8F4` at **any** alpha, including 100% — it is simply too light. So
  accent-derived boundaries are unreachable for that instance by construction.
- A neutral, ink-derived face *can* reach 3:1, but requires ink at 48%, giving
  `#8b8e92`: mid-grey keys that read as **disabled**, with numeral contrast
  falling from ~13:1 to ~5:1.

That is acceptable, and it is the correct reading of the requirement. WCAG 1.4.11
asks for 3:1 on the visual information *required to identify* a control. The
numeral identifies the key unambiguously at **11.7–14.0:1**; the circle is
decoration. iOS's own keypad is built this way.

The tinted wash is therefore chosen not because it clears a threshold nothing can
clear, but because it (a) beats today on the same metric, (b) does not depend on
a shadow that dark mode erases, which is the actual defect, and (c) derives from
`--accent`, so each instance's keys take its colour with no per-instance CSS.

`ABC`/`DEF` are dropped.

The bottom row depends on whether the PIN length is known, since that is what
decides whether `OK` exists at all:

| PIN length | bottom row |
|---|---|
| known (auto-submit active) | `←` · `0` · `clear` |
| unknown (fallback) | `←` · `0` · `OK` |

`clear` fills the cell `OK` vacates rather than leaving a visible hole, and
reuses the `.pin-key[data-value="clear"]` rule already present in the stylesheet.
It is a small addition and can be dropped for an empty cell if it does not earn
its place in review.

### Auto-submit: remember the PIN length on the device

On a successful login, store the length in `localStorage` under
`passbook_pin_length_<instance>`, matching the existing
`passbook_session_<instance>` convention in `api.js`.

- **Length known** → dots render at that count; entry submits on the last digit;
  `OK` is not rendered.
- **Length unknown** (first login on a device) → 6 dots, `OK` retained, enabled
  at ≥4 digits. Exactly today's behaviour, so the fallback is the status quo.

Written on successful PIN verify, on successful setup, and on successful
**change-PIN** — the last matters because a change can alter the length.

**Self-healing.** A stored length can go stale (PIN changed on another device).
Two consecutive failed verifies at the remembered length clears the stored value
and restores `OK`. Without this, auto-submit would fire at the wrong count every
time and silently consume the 5-attempt budget.

Rejected alternatives: adding `pin_length` to `/api/auth/status` (that endpoint
is unauthenticated, so it would tell an attacker the keyspace is exactly 10,000
rather than 10,000 + 100,000 + 1,000,000); and auto-submitting at 4 regardless
(burns a real attempt on every unlock for a 5- or 6-digit PIN).

Storing the length locally discloses it to someone holding an unlocked device —
who already holds a live session token. Accepted.

### No layout shift

Cache the biometric-available answer per instance
(`passbook_biometric_<instance>`) alongside the length. A returning enrolled user
renders the slot on first paint, so nothing moves. The cached value is refreshed
when the real check resolves.

First-ever load caches nothing and reserves nothing — always correct, because
enrollment requires a prior successful login, so a first-load user cannot be
enrolled.

### Setup screen: inherits styling, excluded from auto-submit

`#setup-screen` picks up the layout and key treatment through the shared classes,
which is wanted for consistency. It must **not** auto-submit: the user is
*choosing* a length there, so submitting at 4 digits would make a 5- or 6-digit
PIN unsettable. It keeps `OK` and all six dots, which double as the "4–6 digits"
affordance.

### Accessibility

- Auto-submit acts without the user pressing anything, so it must announce
  itself. The dots container is already `role="status" aria-live="polite"`; the
  verifying state needs to reach that live region rather than only changing
  `#auth-message` text.
- `:focus-visible` is `outline: 2px solid var(--accent)`, which on `eatout`
  measures ~2.9:1 against the page. Unlike the key face, a focus indicator **is**
  required to reach 3:1, and unlike the key face it is achievable. Introduce a
  `--focus-ring` token following the exact pattern established by `--bar-positive`
  / `--bar-negative` / `--danger-ink` in v2.8.0: derived from `--accent` via
  `color-mix`, deepened toward black in light and lifted toward white in dark, so
  each instance keeps its own hue. The alpha is settled by measurement at
  implementation time and the resulting ratios recorded in the CSS comment.
- Keys keep their existing 44px+ effective target size; `aspect-ratio: 1` on a
  fluid grid increases it on most phones rather than reducing it.
- Physical keyboard keeps working: digits, Backspace, and Enter (Enter still
  submits when the length is unknown).

## Out of scope

- Any change to the auth API or its contract.
- Rate limiting, lockout logic, or the Argon2 parameters — all settled earlier
  and untouched here.
- Dashboard, history panel, or modal styling. Only the shared PIN classes move,
  and only the two PIN screens consume them.
- The one-time "enable biometrics?" prompt after login — its copy and timing stay
  as they are.

## Testing

Frontend tests run under `bun test` with happy-dom, which has **no layout
engine** — so anything geometric cannot be asserted there, and pretending
otherwise is how the `offsetParent` focus-trap bug slipped through earlier.
Split accordingly:

**Unit-testable (bun + happy-dom):**

- PIN-length memory: stored on success; read on init; dots rendered at the stored
  count; `OK` absent when known and present when unknown.
- Auto-submit fires at exactly the stored length, and not before.
- Self-heal: two consecutive failures at the stored length clears it and restores
  `OK`.
- Setup screen does **not** auto-submit at 4 digits.
- Biometric slot reserved when the cached flag says enrolled; not reserved on a
  first load.
- Storage keys are instance-scoped, and one instance's values are not read by
  another (the same defect class as the logout cache purge fixed in v2.8.0).

**Stylesheet-asserted (as done for the spend bars in v2.8.0):**

- Keys carry no `box-shadow` and derive their face from `--accent`.
- A `max-height` media query exists for short viewports.
- Focus ring derives from a token that clears 3:1.

**Measured, not asserted:** contrast figures recomputed for both instances in
both schemes, as in this document, and recorded in the CSS comment so the next
person does not have to re-derive them.

**Not automatable here:** thumb-zone placement, the absence of layout shift as
perceived, and landscape behaviour. Verify by hand on a real phone in both
schemes and both instances before merging.

## Risks

- **A stale remembered length silently eats login attempts.** Mitigated by the
  two-failure self-heal; that mitigation is the highest-value test in the set.
- **Auto-submit removes the user's chance to review before committing.** A
  mistyped last digit submits immediately and costs an attempt where today it
  would not. Backspace covers correction *before* the last digit only. Judged
  acceptable — it is how every phone lock screen behaves — but it is a real
  behaviour change, not a pure improvement.
- **Bottom-anchoring changes muscle memory** for existing users of both live
  instances.
- **Shared classes mean the setup screen changes appearance** without being the
  target of the work. Intended, but it must be looked at, not assumed.

## Deviations

Recorded because two of these were defects in the plan rather than in its
execution, and both were invisible to the test suite as designed.

**`.btn-biometric` had no stylesheet rule.** The plan moved the biometric button
off `btn btn-outline btn-full` — whose comment read "reuse existing button
styling so no CSS changes are needed" — and then never added a replacement rule.
The fastest way into the app rendered as an unstyled `<button>`. Nothing could
have caught it: happy-dom sees no styling, and no test looked at the class. Added
with the same tinted-wash language as the keys, one step quieter, plus a
scheme-aware `--biometric-ink` because it sits on a tinted fill rather than on
the page. Measured — text 4.56–8.35 (needs 4.5), border 4.76–8.76 (needs 3). A
wiring test now fails if the rule disappears again.

**The wrong-PIN shake was dead code.** `prepareAuthScreen` rebuilds the dots
through `renderPinDots`, which clears the container, so marking them with
`showPinError` first left `.error` on detached nodes and the 300 ms shake never
painted — a rejected PIN gave text feedback but no visual one. The `catch`
block's 429/401 paths already ordered it the other way, so the file was
internally inconsistent too. Order is now: self-heal, then rebuild, then mark.
Two tests cover it; none did before.

**A test in the plan could not pass against its own implementation.** Task 6's
assertion sat behind `await Promise.resolve()`, one microtask too late: the
stubbed `verifyPin` resolves immediately, so `submitAuth`'s success continuation
— which calls `prepareAuthScreen` and resets the label to "0 digits entered" —
runs first. The announcement only exists synchronously, while the verify is in
flight. Assertion moved off the await.

**Task 2's fixture lacked an attribute Task 6 asserted.** The inline
`#auth-pin-display` had no `aria-live`, so the announcement test failed on the
fixture rather than the code. Fixture corrected to match the real markup instead
of leaning on `index.html`.

**Added beyond the plan: `frontend/test/index_markup.test.js`.** The plan left
`index.html` covered by nothing, because every other frontend test builds its own
inline fixture. That is a silent failure mode — `auth.js` resolves
`#biometric-slot` and `[data-value="clear"]` by hook, and this rework introduced
three such hooks at once, so a markup regression would disable a feature while
every test still passed. Parsed as a document rather than grepped, so it asserts
structure (the slot is a sibling of the pad, the pad is outside the identity
band) and not merely presence.

**eslint gained `DOMParser` and `Node` as test-only globals**, deliberately not
in `browserGlobals` — app code parses no HTML and reads no `Node` constants, so
declaring them there would have weakened `no-undef`. Verified with a probe that
app code still errors on a typo'd `Node`.

**Cosmetic prediction misses.** Task 1 Step 2 predicted `Export named … not
found`; Bun reports `Cannot find module`. Task 1 Step 5 predicted 12 tests; there
are 13, because the eight-value bad-length loop is a single `test`.

## Visual verification

The checks listed as "not automatable here" were done by rendering the real page
in headless Chromium (CDP, `Emulation.setEmulatedMedia` for the colour scheme,
localStorage seeded before boot to reach the interesting states), at four
viewports across both instances and both schemes.

A first attempt used `--force-prefers-color-scheme=dark` and produced screenshots
that were **pixel-identical to the light ones** — the flag was silently ignored.
Worth recording: eyeballing an image one has asked to be dark is a very easy way
to certify the opposite of what was tested. Confirmed objectively thereafter by
sampling mean RGB (`page=(18,22,32)` dark vs `(240,243,250)` light).

Confirmed: dark-mode keys clearly visible on both instances, which is the defect
this rework exists to fix · pad bottom-anchored in the thumb zone · four dots and
no OK once a length is remembered · `.btn-biometric` rendering correctly and
taking each instance's accent · landscape and a 320px phone both fitting.

It found three defects the suite could not reach — the toast landing on the
keypad, the biometric button butted against the dots, and landscape clipping the
bottom two key rows. All three fixed, with stylesheet-text tests.

Still worth a glance on real hardware, since a renderer is not a phone: thumb
reach is ergonomic rather than geometric, and no emulation covers actual touch
targets or the real biometric prompt.
