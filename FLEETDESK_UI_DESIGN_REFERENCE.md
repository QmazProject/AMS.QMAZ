# FleetDesk UI Design Reference

This document describes the visual language used by FleetDesk so it can be reused in another web system. It covers the dashboard, forms, scheduling views, resource cards, drawers, notifications, and authentication screens.

## 1. Design direction

FleetDesk uses a **calm operational dashboard** style. It is designed to feel dependable, organized, and modern without looking overly corporate or technical.

The visual character is built from five ideas:

1. **Deep forest green for trust and control** — used for the sidebar, primary actions, feature panels, and authentication branding.
2. **Warm off-white workspace** — reduces the harshness of a pure gray or white application background.
3. **White information surfaces** — cards and tables remain clear against the off-white canvas.
4. **Lime as a controlled accent** — reserved for branding, active navigation, success emphasis, and high-value calls to action.
5. **Muted semantic colors** — blue, orange, purple, and red communicate state without overpowering operational data.

The result is a UI that feels suitable for logistics, administration, HR systems, asset management, procurement, and other internal company tools.

## 2. Color system

### Core palette

| Token | Hex | Main purpose |
|---|---:|---|
| `--ink` | `#172522` | Primary text and high-emphasis information |
| `--muted` | `#6F7F7A` | Secondary text, descriptions, captions |
| `--muted-2` | `#98A49F` | Low-emphasis metadata and helper text |
| `--canvas` | `#F4F6F3` | Main application background |
| `--surface` | `#FFFFFF` | Cards, forms, tables, drawers |
| `--line` | `#E2E8E4` | Standard borders and dividers |
| `--line-soft` | `#EDF1EE` | Subtle row and card separators |
| `--brand` | `#173E37` | Primary brand color and buttons |
| `--brand-2` | `#24594F` | Hover state, links, secondary brand emphasis |
| `--lime` | `#C9F36B` | Brand accent, selected navigation, positive emphasis |
| `--lime-dark` | `#92BD38` | Stronger lime for progress and selected-date accents |
| `--orange` | `#F19B61` | Attention, pending, time-sensitive information |
| `--blue` | `#6495ED` | Active or in-progress information |
| `--purple` | `#9B86E5` | Resource and secondary metric categories |
| `--danger` | `#D75C58` | Errors, destructive actions, expiry warnings |

### Copy-ready design tokens

```css
:root {
  --ink: #172522;
  --muted: #6f7f7a;
  --muted-2: #98a49f;

  --canvas: #f4f6f3;
  --surface: #ffffff;
  --line: #e2e8e4;
  --line-soft: #edf1ee;

  --brand: #173e37;
  --brand-2: #24594f;
  --lime: #c9f36b;
  --lime-dark: #92bd38;

  --orange: #f19b61;
  --blue: #6495ed;
  --purple: #9b86e5;
  --danger: #d75c58;

  --shadow: 0 18px 55px rgba(26, 47, 40, 0.10);
  --shadow-soft: 0 7px 24px rgba(26, 47, 40, 0.07);
  --radius: 18px;
}
```

### Recommended color proportions

- **65–75% neutral:** canvas, surfaces, lines, and white space.
- **15–25% forest green:** navigation, important panels, headings, and primary actions.
- **5–10% accent colors:** lime and semantic blue, orange, purple, or red.

Lime should remain special. If it is used on every card or button, it loses its ability to indicate active or important actions.

### Soft icon backgrounds

Metric icons use a pale background with a darker foreground from the same color family.

| Variant | Background | Foreground | Typical meaning |
|---|---:|---:|---|
| Lime | `#EFFBD7` | `#668D1E` | Success, available, completed |
| Blue | `#EAF1FF` | `#4777CB` | Schedule, active trip, information |
| Orange | `#FFF0E7` | `#CA7540` | Pending, time, attention |
| Purple | `#F0ECFF` | `#7660C7` | Vehicles, capacity, supporting metric |

### Status colors

Statuses are displayed as compact pills containing a small colored dot. Pale backgrounds are used so status labels can coexist inside dense tables.

| Status | Text/dot | Background |
|---|---:|---:|
| Scheduled / Available | `#397463` | `#EAF5F1` |
| Pending | `#B36A32` | `#FFF3E8` |
| In progress | `#386DBD` | `#EAF1FF` |
| Completed / Off duty | `#67736E` | `#EEF1EF` |
| Declined / Maintenance | `#B84F4A` | `#FFEDEB` |

Priority uses a related but slightly stronger badge treatment:

| Priority | Text | Background |
|---|---:|---:|
| Normal | `#66766F` | `#EEF2EF` |
| High | `#BD6C37` | `#FFF0E5` |
| Urgent | `#C64C47` | `#FFEAE8` |

## 3. Typography

FleetDesk uses two complementary sans-serif families:

- **Manrope** — headings, key numbers, brand text, and prominent labels.
- **DM Sans** — body text, controls, tables, navigation, and metadata.

```css
font-family: "DM Sans", sans-serif;

h1, h2, h3, .brand-name, .metric-value {
  font-family: "Manrope", sans-serif;
}
```

### Type hierarchy

| Role | Size | Weight | Notes |
|---|---:|---:|---|
| Authentication hero | `40px` | `800` | Tight `1.12` line-height, `-1.3px` tracking |
| Page heading | `27px` | `800` | Tight `1.15` line-height, `-0.8px` tracking |
| Authentication card heading | `25px` | `800` | Reduced to `21px` on mobile |
| Metric value | `25px` | `800` | Tight tracking for dashboard numbers |
| Drawer title | `18px` | `800` | Clear but compact |
| Card heading | `14–15px` | `700` | Used for grouped information |
| Body/supporting copy | `11–14px` | `400–600` | Depends on density and context |
| Labels/metadata | `8–10.5px` | `600–800` | Often uppercase with added tracking |

The dashboard intentionally uses compact text because it is data dense. For a less dense system, increase ordinary body text to `14–16px`, form inputs to at least `14px`, and metadata to at least `11–12px`.

## 4. Layout system

### Application shell

- Fixed sidebar width: `246px`.
- Sticky desktop top bar: `76px` high.
- Main page maximum width: `1500px`.
- Desktop page padding: `30px 34px 52px`.
- Mobile page padding: `24px 18px 40px`.
- The page background is `--canvas`; content cards are `--surface`.

```text
┌──────────────┬───────────────────────────────────────────┐
│              │ Sticky top bar                            │
│ Fixed        ├───────────────────────────────────────────┤
│ sidebar      │ Page heading + page-level action          │
│ 246px        │                                           │
│              │ Cards, tables, schedules, resource grids  │
│              │                                           │
└──────────────┴───────────────────────────────────────────┘
```

### Dashboard composition

- Summary metrics use a four-column grid.
- Main dashboard content uses a `1.65fr / 0.85fr` two-column layout.
- The wider column contains schedules and utilization data.
- The narrower column contains a strong action card and attention items.
- Standard gaps are `14px` for compact grids and `18px` for major sections.

### Authentication composition

- Desktop authentication uses a near-even split: `1.02fr / 1fr`.
- The left panel is a dark brand/story panel.
- The right panel centers a white form card with a maximum width of `530px`.
- Below `900px`, the brand panel disappears and a compact mobile logo appears inside the form card.

### Drawers

Operational create/edit/detail actions use a right-side drawer instead of a centered modal.

- Maximum width: `610px`.
- Full viewport height.
- Sticky header and fixed footer.
- Scrollable body with extra bottom padding to prevent footer overlap.
- Backdrop: dark green-black at `45%` opacity with `3px` blur.

This pattern keeps the current dashboard visible behind the task and preserves operational context.

## 5. Spacing and sizing

The interface follows a compact spacing rhythm derived mainly from these values:

```text
4, 5, 8, 9, 10, 11, 12, 14, 15, 18, 20, 24, 26, 30, 34px
```

Recommended reusable scale:

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 14px;
  --space-5: 18px;
  --space-6: 24px;
  --space-7: 30px;
  --space-8: 34px;
}
```

Control heights:

- Standard button/search/filter: `40px`.
- Standard form field: `42px`.
- Authentication field: `46px`.
- Authentication primary action: `50px`.
- Small action: `33px`.
- Icon button: `40 × 40px`.
- Table row: approximately `68px`.
- Dispatch row: approximately `76px`.

## 6. Shape, depth, and borders

FleetDesk uses rounded geometry, but avoids excessive pill shapes.

| Element | Radius |
|---|---:|
| Major cards | `16–18px` |
| Authentication card | `24px` |
| Buttons and inputs | `10–13px` |
| Icon containers | `9–14px` |
| Status pills | `20px` |
| Avatars | `50%` or softly rounded square |

Depth is intentionally subtle:

- Most cards use a very faint `3px 15px` shadow at roughly `2.5%` opacity.
- Floating controls use `--shadow-soft`.
- Drawers, authentication cards, and toast notifications use `--shadow` or a stronger directional shadow.
- Borders remain visible even when shadows are present. This keeps surfaces clear on low-quality office monitors.

## 7. Component patterns

### Sidebar navigation

- Dark forest gradient from `#183D36` to `#102B27`.
- Inactive text is desaturated green-gray.
- Hover adds a translucent white background.
- Active navigation uses white text, a `10%` white surface, and a `3px` lime inset bar.
- Notification counts use a lime pill with dark green text.
- Support information and the user profile are anchored at the bottom.

### Top bar

- Sticky and semi-transparent.
- Uses the canvas color at `88%` opacity with `14px` backdrop blur.
- Breadcrumb sits left; notifications and the primary action sit right.
- On small screens, breadcrumbs disappear and the primary action becomes icon only.

### Primary button

```css
.primary-button {
  min-height: 40px;
  padding: 0 15px;
  border: 0;
  border-radius: 11px;
  background: #173e37;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  box-shadow: 0 7px 18px rgba(23, 62, 55, 0.16);
  transition: 0.2s ease;
}

.primary-button:hover {
  background: #24594f;
  transform: translateY(-1px);
}
```

Use the lime button variation only on a dark green panel. It should not replace the standard green primary button across the whole system.

### Cards

- White background.
- Soft border using `--line-soft`.
- `16–18px` radius.
- Very light shadow.
- Card headers are usually `64px` high with `18px 20px` padding.
- Header and body are separated by a soft one-pixel divider.

### Metric cards

Each metric card follows this order:

1. Colored icon bubble and small context badge.
2. Muted metric label.
3. Large Manrope value.
4. Low-emphasis supporting sentence.

Do not make every metric a different strong color. The card remains neutral; only the icon bubble changes category color.

### Tables

- White card container with horizontal overflow on smaller screens.
- Header uses a near-white background and uppercase `9px` labels.
- Rows are separated by `--line-soft`.
- Row hover uses `#FBFCFB`.
- Primary cell content is bold; supporting content is muted and smaller.
- Status and priority are expressed as badges rather than raw colored text.

### Forms

- Two columns on desktop, one column on mobile.
- Labels sit above controls.
- Inputs use white or near-white backgrounds and `10–12px` radii.
- Focus uses a green border plus a translucent green focus ring.
- Required and invalid states use the danger family.
- Form content is grouped into numbered sections to reduce cognitive load.
- Supporting instructions use pale green information strips.
- Warnings use pale orange strips.

Recommended focus treatment:

```css
input:focus,
select:focus,
textarea:focus {
  outline: none;
  border-color: #8baaa1;
  box-shadow: 0 0 0 4px rgba(36, 89, 79, 0.08);
}
```

### Authentication card

- Uses a segmented sign-in/create-account control.
- Active tab is a white sliding surface over a muted green-gray track.
- Fields are slightly taller than dashboard fields.
- Icons are placed inside the left side of controls.
- Password visibility is an icon-only button inside the right side.
- The main submit button spans the entire form.
- Loading uses a small white spinner while the button label fades.
- Demo information uses a dashed light-green panel so it reads as non-production help.

### Schedule board

- Five equal day columns separated by one-pixel lines.
- Today uses a pale lime background and a lime-green top inset.
- Trip cards use a colored left border to communicate state.
- Cards display time, request ID, destination, purpose, driver, and vehicle.
- At smaller widths the board scrolls horizontally instead of crushing the columns.

### Toast notifications

- Bottom-right on desktop, full-width inset on mobile.
- Dark brand background.
- Lime success icon.
- White title with muted green supporting copy.
- Short upward fade-in animation.

## 8. Iconography

The system uses lightweight outline SVG icons:

- `24 × 24` view box.
- No fill except intentional dots.
- `currentColor` stroke so icons inherit component colors.
- Typical displayed size: `14–22px`.
- Stroke width: approximately `1.8–2px`.
- Icons are normally paired with text unless the action is universally understood and has an accessible label.

For another project, use one consistent icon family such as Lucide, Feather, or custom icons with the same visual weight. Do not mix solid, outlined, and multicolor icon sets.

## 9. Responsive behavior

### Main application breakpoints

| Breakpoint | Behavior |
|---:|---|
| `≤1120px` | Metrics and resource cards change to two columns; less important dispatch details are hidden |
| `≤830px` | Fixed sidebar becomes an off-canvas menu; main content uses full width; dashboard becomes one column |
| `≤580px` | Toolbars wrap, forms become one column, resource cards become one column, labels in the top action hide |

### Authentication breakpoints

| Breakpoint | Behavior |
|---:|---|
| `≤1080px` | Brand panel typography and metrics become more compact |
| `≤900px` | Brand panel is hidden and the form becomes a single-column page |
| `≤560px` | Form card padding decreases and all form fields stack |
| Height `≤820px` | Vertical spacing is tightened to keep sign-in content inside a laptop viewport |

Important responsive principles:

- Preserve actions before preserving decoration.
- Hide duplicate context such as breadcrumbs before hiding task controls.
- Allow wide operational content, especially schedules and tables, to scroll horizontally.
- Convert the sidebar to an overlay instead of permanently reducing mobile content width.
- Keep touch targets around `40px` or larger.

## 10. Motion and feedback

Motion is short and functional:

- Page entrance: `280ms` fade with a `5px` upward movement.
- Drawer entrance: `270ms` horizontal movement.
- Hover and control transitions: `160–220ms`.
- Authentication tab glider: `280ms` using a standard ease curve.
- Validation error: short horizontal shake.
- Loading: continuous spinner.

The authentication view includes a `prefers-reduced-motion` rule. This should be expanded to cover page, drawer, trip-card, and toast animation when the design is moved into a production system.

## 11. Accessibility analysis

### Strengths

- Main text has very strong contrast.
- White text on brand green and lime on brand green are both highly readable.
- Statuses combine text, color, and a dot rather than relying on color alone.
- Inputs receive a visible focus ring.
- Authentication validation uses messages and `aria-invalid`.
- Icon-only controls generally have accessible labels.
- The interface has responsive behavior down to a `320px` viewport.

### Contrast reference

Approximate WCAG contrast ratios:

| Combination | Ratio | Assessment |
|---|---:|---|
| Ink `#172522` on canvas `#F4F6F3` | `14.59:1` | Excellent |
| Brand `#173E37` on white | `11.79:1` | Excellent |
| White on brand `#173E37` | `11.79:1` | Excellent |
| Lime `#C9F36B` on brand `#173E37` | `9.28:1` | Excellent |
| Brand-2 `#24594F` on white | `8.02:1` | Excellent |
| Muted `#6F7F7A` on white | `4.21:1` | Slightly below AA for small normal text |
| Danger `#D75C58` on white | `3.78:1` | Use for larger/bold text or darken it |
| Muted-2 `#98A49F` on white | `2.58:1` | Decorative metadata only; not suitable for essential small text |

### Improvements recommended during migration

- Increase very small `8–10px` metadata to at least `11–12px` where space allows.
- Darken `--muted` to approximately `#62716C` when it carries required information.
- Darken danger text to approximately `#B94743` on white.
- Do not use `--muted-2` for instructions, validation, or other information users must read.
- Add `:focus-visible` states to all buttons, links, navigation items, and clickable cards.
- Apply reduced-motion handling to the entire application.
- Ensure off-canvas navigation traps focus and returns focus to the menu button when closed.
- Give horizontally scrolling tables and schedules an accessible name and keyboard-scroll option.

## 12. What makes the design work

### Strong points

- The color palette clearly belongs to one product.
- The forest/lime combination is memorable without feeling playful.
- Operational information is dense but grouped into recognizable surfaces.
- Actions use consistent placement: page-level actions at the top right, card actions in headers, and task actions in drawer footers.
- Semantic states remain soft enough for users to scan a full schedule or request table.
- Drawers support complex workflows without sending users to disconnected pages.
- Authentication feels like the same product because it reuses the same palette, typography, icons, forms, and shadows.

### Risks when copying it

- Copying only the green and lime colors will not reproduce the design. The off-white canvas, subtle dividers, muted type, spacing, and restrained shadows are equally important.
- Excessive lime will make the system feel promotional rather than operational.
- Small typography works for compact fleet information but may be unsuitable for public-facing systems or users with low vision.
- Too many semantic colors on one card will weaken the hierarchy. Keep the surface neutral and color only the status, icon, or edge.

## 13. Migration checklist

Use this sequence when applying the design to another project:

1. Add the core CSS tokens before styling individual screens.
2. Load Manrope and DM Sans, or select equivalent geometric and neutral sans-serif fonts.
3. Set the application canvas to `#F4F6F3` and all information surfaces to white.
4. Rebuild the shell: forest sidebar, translucent sticky top bar, and centered page container.
5. Standardize cards, buttons, inputs, badges, and icon bubbles.
6. Map the old system’s statuses to the semantic status palette.
7. Convert complex create/edit operations to right-side drawers where context should remain visible.
8. Implement the `1120px`, `830px`, and `580px` responsive transitions.
9. Add hover, focus, loading, success, empty, validation, and error states.
10. Review contrast and raise small font sizes before production release.

## 14. Quick theme starter

The following base styles capture the central appearance without depending on FleetDesk-specific components:

```css
@import url("https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@600;700;800&display=swap");

:root {
  --ink: #172522;
  --muted: #6f7f7a;
  --canvas: #f4f6f3;
  --surface: #ffffff;
  --line: #e2e8e4;
  --line-soft: #edf1ee;
  --brand: #173e37;
  --brand-hover: #24594f;
  --accent: #c9f36b;
  --danger: #d75c58;
  --radius-card: 18px;
  --radius-control: 11px;
  --shadow-soft: 0 7px 24px rgba(26, 47, 40, 0.07);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  color: var(--ink);
  background: var(--canvas);
  font-family: "DM Sans", sans-serif;
  text-rendering: optimizeLegibility;
}

h1, h2, h3 {
  font-family: "Manrope", sans-serif;
  letter-spacing: -0.03em;
}

.surface {
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-card);
  box-shadow: 0 3px 15px rgba(26, 47, 40, 0.025);
}

.control {
  min-height: 42px;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--surface);
}

.control:focus {
  outline: none;
  border-color: #8baaa1;
  box-shadow: 0 0 0 4px rgba(36, 89, 79, 0.08);
}

.button-primary {
  min-height: 40px;
  padding: 0 15px;
  border: 0;
  border-radius: var(--radius-control);
  color: #fff;
  background: var(--brand);
  font-weight: 700;
  cursor: pointer;
  transition: 0.2s ease;
}

.button-primary:hover {
  background: var(--brand-hover);
  transform: translateY(-1px);
}
```

## 15. Source files

The live implementation described by this reference is located in:

- `styles.css` — design tokens, application components, responsive rules, and authentication styling.
- `app.js` — dashboard, request, schedule, vehicle, driver, report, drawer, status, and toast component markup.
- `auth.js` — authentication layouts, validation states, password strength, account modes, and feedback behavior.
- `index.html` — font imports and application entry structure.

Use this document as the portable design specification; use the source files when exact implementation details are needed.
