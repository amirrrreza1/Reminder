# Design system

Reminder uses an original **warm neo-brutalist utility** style inspired by the visual language of [GitReverse](https://www.gitreverse.com/): warm paper-like backgrounds, dark structural outlines, hard offset shadows, compact corner radii, bold type, and a restrained red accent. The project does not copy GitReverse branding, content, layouts, or source code.

The reference was visually inspected on 2026-07-29. Observed cues included an off-white `#FFFDF8` canvas, cream `#FFF4DA` feature surface, near-black `#18181B` outlines, red `#D31611` actions, sand `#EBDBB7` chips, 3 px borders, 4–12 px radii, and offset dark shadow blocks. Reminder adapts those cues to dense, recurring information rather than a single landing-page form.

## 1. Design goals

- Make the next date and countdown unmistakable at a glance.
- Feel warm, direct, and memorable without becoming visually noisy.
- Keep every state legible without relying on color alone.
- Work from 360 px mobile widths to wide desktops.
- Preserve keyboard focus, semantic structure, screen-reader behavior, and reduced motion.
- Remain RTL-safe even before Persian translation is shipped.

## 2. Design tokens

Tokens are semantic CSS custom properties. Components must not introduce arbitrary colors when a semantic token fits.

### Color

| Token                    | Light value              | Use                                           |
| ------------------------ | ------------------------ | --------------------------------------------- |
| `--color-canvas`         | `#FFFDF8`                | Page background                               |
| `--color-surface`        | `#FFF4DA`                | Primary cards and modal sections              |
| `--color-surface-raised` | `#FFFFFF`                | Inputs, menus, modal body                     |
| `--color-surface-muted`  | `#EBDBB7`                | Type chips and secondary badges               |
| `--color-ink`            | `#18181B`                | Text, borders, hard shadows                   |
| `--color-ink-muted`      | `#52525B`                | Secondary copy                                |
| `--color-ink-subtle`     | `#71717A`                | Metadata with AA contrast on white/canvas     |
| `--color-accent`         | `#D31611`                | Primary actions and urgent status             |
| `--color-accent-hover`   | `#B81410`                | Primary hover/pressed                         |
| `--color-warm-hover`     | `#FFC480`                | Secondary/chip hover                          |
| `--color-success`        | `#16794A`                | Sent/configured/healthy                       |
| `--color-warning`        | `#9A5B00`                | Due soon/retry                                |
| `--color-info`           | `#145DA0`                | Neutral provider/status information           |
| `--color-disabled`       | `#D4D4D8`                | Disabled surfaces; never sole state indicator |
| `--color-overlay`        | `rgba(24, 24, 27, 0.56)` | Modal scrim                                   |

Primary red with white text and all muted text/background combinations must be verified with automated contrast checks. If implementation/font rendering changes reduce WCAG AA contrast, darken the foreground token rather than adding a text shadow.

No dark theme is in MVP because Settings intentionally contains only the four requested preferences. Token names allow a future theme without component rewrites.

### Typography

- Primary family: **Geist Sans**, self-hosted from a pinned open-source package; fallback `ui-sans-serif, system-ui, sans-serif`.
- Monospace: **Geist Mono**, only for technical values in developer/health surfaces; fallback `ui-monospace, monospace`.
- Body: 16 px / 24 px, weight 400.
- Small metadata: 14 px / 20 px, weight 500.
- Labels/buttons: 14–16 px, weight 650–700.
- Card title: 20 px / 26 px, weight 750.
- Page title: clamp from 36 px / 40 px to 56 px / 58 px, weight 800, tight tracking.
- Numeric countdown: 28–40 px, weight 800, tabular numbers.

Fonts are bundled with the application; the UI does not make runtime calls to a font CDN.

### Spacing

Use a 4 px base scale:

```text
1: 4px   2: 8px   3: 12px   4: 16px   5: 20px
6: 24px  8: 32px  10: 40px  12: 48px  16: 64px
```

Default card padding is 20–24 px. Form row gap is 16 px. Dashboard section gap is 24–32 px.

### Borders, radii, and shadows

- Structural border: `3px solid var(--color-ink)`.
- Subtle divider: `1px solid #E4E4E7`.
- Small control radius: 4 px.
- Chip radius: 6 px.
- Card/modal radius: 12 px.
- Large hard shadow: `8px 8px 0 var(--color-ink)`.
- Control hard shadow: `4px 4px 0 var(--color-ink)`.
- Focus ring: `0 0 0 3px var(--color-canvas), 0 0 0 6px var(--color-accent)`.

Hard shadows are reserved for primary cards, modal shells, and high-priority controls. Nested elements should not all cast shadows.

### Motion

- Duration: 120 ms for press/hover, 160 ms for modal/sheet transition.
- Easing: `cubic-bezier(.2,.8,.2,1)`.
- Hover: move a hard-shadow control at most `-1px -1px`.
- Press: return toward its shadow by `1–2px`.
- No looping decorative animation.
- Under `prefers-reduced-motion: reduce`, remove transforms and use near-instant opacity changes.

## 3. Page layout

### Desktop wireframe

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Reminder                                      [Settings] [＋ Add reminder]│
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ Never miss what comes around.             12 active · 3 due this week   │
│                                                                          │
│ [ Search reminders…          ] [Type ▾] [State ▾] [Sort ▾]              │
│                                                                          │
│ ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐         │
│ │ SUBSCRIPTION     │  │ BIRTHDAY        │  │ RENT             │         │
│ │ Domain renewal   │  │ Mother's day    │  │ Apartment rent   │         │
│ │                  │  │                  │  │                  │         │
│ │       7 days     │  │      18 days     │  │      25 days     │         │
│ │ Nov 15, 2026     │  │ Azar 2, 1405    │  │ Aug 23, 2026     │         │
│ │ $12.99 USD       │  │ Yearly          │  │ 95,000,000 IRR   │         │
│ │ ✉ Email  ◇ TG    │  │ ◇ Telegram      │  │ ✉ Email          │ [Edit]  │
│ └──────────────────┘  └──────────────────┘  └──────────────────┘         │
│   ▀ hard shadow       ▀ hard shadow       ▀ hard shadow                 │
└──────────────────────────────────────────────────────────────────────────┘
```

### Container

- Maximum content width: 1200 px.
- Inline gutter: 16 px at mobile, 24 px at tablet, 32 px at desktop.
- Sticky header: 64 px desktop, 56 px mobile; canvas background; 3 px bottom border.
- Main top/bottom padding: 32/64 px mobile, 48/80 px desktop.

### Grid

- `>= 1100 px`: three equal columns.
- `700–1099 px`: two equal columns.
- `< 700 px`: one column.
- Gap: 24 px desktop, 20 px mobile, with extra 8 px end/bottom room for hard shadows.

Do not use masonry; stable rows make scanning and keyboard order predictable.

## 4. Header and summary

### Header

- Wordmark: “Reminder”; ink text with the final syllable or dot accent in red, but no resemblance to GitReverse’s mark.
- Settings: secondary outlined button with icon and text on desktop; icon with accessible label on narrow mobile.
- Add reminder: red primary button. It remains visible without scrolling.
- At 360 px, the brand may shorten visually to an `R` mark while its accessible name remains “Reminder home.”

### Summary

Use one concise line instead of a dashboard of analytics. Show “12 active · 3 due this week.” Amounts are shown in the settings display currency after Nerkh conversion when a token is configured.

## 5. Reminder card

### Anatomy

1. Type chip and overflow/edit action.
2. Title and optional description.
3. Countdown as the strongest numeric element.
4. Exact formatted date.
5. Recurrence and optional amount.
6. Email/Telegram badges and paused/completed status.

### Surface

- Default background: `--color-surface`.
- Border: 3 px ink; radius 12 px; large hard shadow.
- Minimum height: 260 px desktop. Allow content-driven growth; do not hide title/date/amount.
- Paused: white surface, diagonal 8% ink pattern or “Paused” badge, and no reduced opacity on text.
- Completed: white surface, explicit “Completed” badge; listed only when state filter includes it.

### Urgency

| Timing           | Treatment                                   |
| ---------------- | ------------------------------------------- |
| Overdue          | Red vertical marker + “Overdue” text        |
| Today            | Red countdown and “Today” text              |
| 1–7 days         | Warning-colored countdown + “Due soon” text |
| More than 7 days | Ink countdown                               |
| Paused           | Neutral countdown + “Paused” badge          |

Urgency color is paired with text and icon. A card border remains ink; avoid turning whole cards red/green.

### Interactions

- The card itself may open edit only if it is implemented as a real button/link surface with no nested interactive conflict.
- Preferred MVP: explicit top-right edit icon button and non-interactive card body.
- Hover raises by 1 px; focus shows the global ring on the edit action.
- Touch targets are at least 44 px.

## 6. Buttons

### Primary

- Red background, white text, 3 px ink border, 4–6 px radius, 4 px hard shadow.
- Use once per action group: Add reminder, Save reminder, Save settings.
- Disabled state uses gray surface, ink-muted text, no shadow movement, and an adjacent/associated explanation when needed.

### Secondary

- White or sand background, ink text, 2–3 px ink border, small hard shadow where emphasis is useful.
- Used for Settings, Cancel, filters, and provider tests.

### Destructive

- White surface, red text and border by default; solid red only in the final confirmation dialog.
- Label with the exact object: “Delete reminder.”

### Icon button

- 44×44 px on touch layouts; minimum 36×36 on desktop with a 44 px hit target.
- Every icon-only control has an accessible name and tooltip for pointer users.

## 7. Forms

### Controls

- White background, 3 px ink border, 4–6 px radius.
- Minimum control height: 48 px; textarea minimum 112 px.
- Label above control; required state expressed in text, not only an asterisk.
- Supporting text follows the control when it prevents mistakes.
- Focus uses the global ring and never relies only on border color.
- Invalid state uses red border plus error icon/text connected through `aria-describedby`.

### Modal structure

Desktop reminder modal: maximum 720 px wide and no more than 90 viewport height. Its header and footer stay visible while the form body scrolls.

```text
┌──────────────────────────────────────────────┐
│ Add reminder                          [Close]│
├──────────────────────────────────────────────┤
│ Basics                                       │
│ [Title____________________________________]  │
│ [Type________________▼]                      │
│ [Description______________________________]  │
│                                              │
│ Schedule                                     │
│ [Date____________] [Repeats___________▼]     │
│ [Every__] [month(s)___________________▼]     │
│ [Remind me__ days before]                    │
│                                              │
│ Amount (optional)                            │
│ [Amount________________] [IRR__________▼]     │
│                                              │
│ Notifications                                │
│ [switch] Email        [switch] Telegram      │
├──────────────────────────────────────────────┤
│ [Delete reminder]              [Cancel][Save]│
└──────────────────────────────────────────────┘
```

On screens below 640 px, use a full-height dialog/sheet with safe-area padding. It is still semantically a modal dialog. Avoid side-by-side fields below 480 px.

### Field behavior

- Choosing a type sets defaults only for untouched fields on create.
- Amount is collapsed/optional but discoverable through “Add amount.”
- Channel switches show “Not configured” and are disabled when environment support is missing.
- Recurrence summary appears in plain language: “Every year on 12 Aban (Jalali).”
- Before saving, display the next exact occurrence and notification date as a preview.

## 8. Settings modal

Keep the four preferences visually dominant:

1. Calendar segmented control: Gregorian / Solar Hijri (Jalali).
2. Default currency segmented control: IRR / USD.
3. Email global switch, provider readiness badge, and secondary test action.
4. Telegram global switch, provider readiness badge, and secondary test action.

Provider status is descriptive, not an additional setting. Example:

```text
Email notifications                    [switch on]
Configured by the server · recipient hidden      [Send test]
```

Missing environment example:

```text
Telegram notifications                 [switch disabled]
Not configured by the server
Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, then restart.
```

Do not display masked secrets; even partial values can leak useful information.

## 9. Chips and badges

- Type chip: sand background, 2 px ink border, uppercase 12 px label only when readable; otherwise title case.
- Channel badge: icon + “Email” or “Telegram”; never icon only on cards.
- Status badge: icon + explicit state.
- Recurrence badge: plain text with no border when card density is high.
- Maximum two visual badge styles on one card to avoid a sticker-sheet effect.

## 10. Date and amount presentation

### Dates

- Gregorian long: `15 November 2026` in locale-appropriate order.
- Jalali long: `24 Aban 1405` for English UI; Persian localization may use Persian month names and digits.
- Compact input includes a visible calendar suffix or label.
- Relative and exact date appear together: `7 days` + `15 November 2026`.
- The browser locale may influence digits/formatting but never changes recurrence semantics.

### Amounts

- Use locale grouping and tabular numbers.
- IRR: `1,250,000 IRR`.
- USD: `$12.50 USD` where ambiguity is possible; the card may use `$12.50` with an adjacent USD label.
- Never combine currencies into one total.
- Screen-reader label includes full currency name.

## 11. Empty, loading, error, and offline states

### Empty

A cream hard-shadow panel contains a small original bell/calendar illustration built from project SVG/CSS, one sentence, and Add reminder. No stock illustration is required.

### Loading

Use 3–6 stable card skeletons matching final dimensions. Animation is a subtle opacity pulse and is disabled under reduced motion.

### Error

- Inline errors appear next to the affected surface.
- Preserve last successful reminders on background refresh failure and show a compact retry banner.
- Full-page failure is reserved for no usable data.
- Provider errors use categories and next action, not raw responses.

### Offline

The MVP is not offline-first. If the browser loses the server, show a persistent “Connection lost—changes cannot be saved” banner and disable mutation submit after a failed request. The server-side worker continues independently.

## 12. Accessibility contract

- Use semantic landmarks: header/nav, main, form, and appropriately leveled headings.
- Dialog title/description are programmatically associated.
- Initial modal focus goes to title on create and modal heading on edit; destructive confirmation receives safe initial focus.
- Focus returns to the exact opener after close.
- Error summary links to invalid controls after a failed submit.
- Live regions announce create/update/delete and provider-test results without stealing focus.
- Segmented controls use radio-group semantics; type/status filters use labeled native/select primitives where practical.
- Countdown text has an exact-date accessible label and does not auto-update noisily.
- Icons are decorative when adjacent text exists.
- Contrast is tested in default, hover, focus, disabled, urgent, paused, and error states.
- At 200% zoom there is no two-dimensional page scroll; modal body may scroll vertically.

## 13. RTL readiness

- Use logical CSS properties (`margin-inline`, `inset-inline-end`, `border-inline-start`).
- Avoid directional icons for abstract actions; mirror arrows/chevrons when direction carries meaning.
- Card DOM order matches reading order in both directions.
- Amount and ISO codes use isolated bidirectional spans to prevent reordering.
- Date input adapters do not assume Latin digit entry; normalize supported Persian/Arabic digits at the boundary.
- Hard shadows use logical inline direction or remain consistently bottom-right as a brand decision after RTL visual testing.

## 14. Responsive requirements

Test at minimum:

- 360×800 mobile;
- 390×844 mobile;
- 768×1024 tablet;
- 1024×768 small desktop;
- 1440×900 desktop;
- 200% browser zoom at 1280 px viewport.

At narrow widths:

- header text actions may become icon actions with accessible labels;
- filters wrap or open one compact filter popover;
- card metadata stacks but date/countdown remain above the fold of the card;
- modal fields become one column;
- sticky modal footer respects safe areas and does not obscure the focused input.

## 15. Implementation rules

- Build project components from tokens; do not copy CSS/classes from the reference site.
- Prefer component variants over one-off utility strings for borders/shadows/state.
- Use Lucide icons from one pinned version; do not mix icon families.
- Do not use emoji as functional icons because platform rendering is inconsistent.
- Do not introduce gradients, glass effects, soft drop shadows, or large pill shapes into the MVP visual language.
- Do not animate card order when filters or data change; preserve focus and reduce motion.
- Keep visual regression snapshots for dashboard states, both modals, mobile, desktop, and 200% zoom.

## 16. Design QA checklist

- [ ] Primary hierarchy is title/date/countdown, not type or controls.
- [ ] At most one red primary action exists per action group.
- [ ] Hard shadows do not cause clipped content or horizontal page scrolling.
- [ ] Exact dates remain visible next to relative countdowns.
- [ ] Amounts are shown in one display currency; stored IRR and USD values are not mixed without conversion.
- [ ] Paused, completed, overdue, today, and due-soon states have text labels.
- [ ] All modal fields and errors are keyboard/screen-reader usable.
- [ ] Channel-disabled states explain environment configuration safely.
- [ ] Reduced-motion and high-contrast behavior are verified.
- [ ] Mobile safe areas, on-screen keyboard, and sticky modal footer are verified.
- [ ] RTL smoke test reveals no clipped labels, reversed amount codes, or misplaced actions.
- [ ] No GitReverse logo, copy, exact page composition, or source asset appears in the product.
