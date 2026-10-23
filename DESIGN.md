---
name: Depositly
description: A cream financial workspace with a green income field and clear yellow actions.
colors:
  paper: "#f5f1e4"
  surface: "#fcfbf5"
  ink: "#2c2e2a"
  muted: "#5d6255"
  line: "#d5d9c7"
  forest: "#344c2f"
  control-green: "#37552a"
  apple-field: "#8ed462"
  field-ink: "#203a16"
  action-yellow: "#f5e211"
  action-hover: "#e4d10d"
  soft: "#e9eddb"
  purple: "#715185"
  red: "#a33c2f"
  positive: "#3e612c"
  positive-soft: "#e0edcf"
  others-soft: "#efe7f4"
  others-ink: "#64407c"
  overdue-soft: "#f7e3d9"
  overdue-ink: "#993c2b"
  legal-copy: "#474b40"
  legal-muted: "#616455"
  legal-rule: "#2c2e2a35"
  dark-paper: "#171e18"
  dark-surface: "#222c21"
  dark-ink: "#edf2df"
  dark-muted: "#bdc9af"
  dark-line: "#3b4b34"
  dark-forest: "#accf8b"
  dark-control-green: "#bad8a3"
  dark-soft: "#2e3b29"
  dark-purple: "#d0b6df"
  dark-red: "#f0aa91"
  dark-positive: "#c4dfab"
  dark-positive-soft: "#30432b"
typography:
  display:
    fontFamily: "Manrope, 'Nirmala UI', system-ui, sans-serif"
    fontSize: "clamp(40px, 4.3vw, 60px)"
    fontWeight: 750
    lineHeight: 1.15
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Manrope, 'Nirmala UI', system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Manrope, 'Nirmala UI', system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 650
    lineHeight: 1.6
    letterSpacing: "-0.025em"
  metric:
    fontFamily: "Manrope, 'Nirmala UI', system-ui, sans-serif"
    fontSize: "36px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.04em"
  body:
    fontFamily: "Manrope, 'Nirmala UI', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0em"
  legal-body:
    fontFamily: "Manrope, 'Nirmala UI', system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.85
  label:
    fontFamily: "Manrope, 'Nirmala UI', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.6
  button:
    fontFamily: "Manrope, 'Nirmala UI', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 650
    lineHeight: 1.6
rounded:
  small: "6px"
  input: "9px"
  button: "10px"
  icon-button: "12px"
  card: "14px"
  dialog: "16px"
  income-field: "16px 16px 62px 16px"
  backup-field: "14px 14px 54px 14px"
  legal-field: "0 0 64px 0"
spacing:
  micro: "4px"
  tight: "8px"
  control: "12px"
  regular: "18px"
  section: "24px"
  wide: "30px"
  page: "40px"
components:
  button-primary:
    backgroundColor: "{colors.action-yellow}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: "10px 18px"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: "10px 18px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    padding: "11px 12px"
  nav-current:
    backgroundColor: "{colors.action-yellow}"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    padding: "10px 12px"
  chip-received:
    backgroundColor: "{colors.positive-soft}"
    textColor: "{colors.positive}"
    rounded: "{rounded.small}"
    padding: "5px 9px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "26px"
  income-field:
    backgroundColor: "{colors.apple-field}"
    textColor: "{colors.field-ink}"
    rounded: "{rounded.income-field}"
    padding: "27px 30px 24px"
  legal-field:
    backgroundColor: "{colors.apple-field}"
    textColor: "{colors.ink}"
    typography: "{typography.display}"
    rounded: "{rounded.legal-field}"
    padding: "33px 42px"
---

# Design System: Depositly

## Overview

**Creative North Star: "Color field"**

Color field makes Depositly a cream financial workspace with a substantial apple-green region for income. Dark, tabular figures and open ruled areas carry the information; yellow gives actions and current selections a clear place in the hierarchy. The character is direct, warm, and practical.

The same materials support two densities: a compact tracker for operating on records and a quieter reading layout for legal documents. Manrope and the supplied Depositly identity connect both. Reuse the broad lower-right curve on important green fields; ordinary controls retain familiar, smaller corners.

**Key Characteristics:**

- Cream work surfaces and open ruled data.
- An apple-green income field with one broad curved corner.
- Yellow primary actions and current selections.
- Manrope with tabular financial figures.
- Responsive stacking with explicit keyboard states.

This is a scan of the implemented system. Tracker sources load `assets/web.css` before `assets/redesign.css`; the final overrides in the latter are authoritative. Privacy and Terms use `assets/style.css` independently. The confirmed direction is recorded in `.impeccable/surfaces/index-html.md`; product and legal truth remain in `PRODUCT.md` and the legal pages. No source copy or legal facts are redefined here.

## Colors

Cream and apple green establish the main materials; muted olive neutrals keep dense financial information legible.

The sidecar's tonal ramps are synthesized swatch previews, not additional shipped colors. The frontmatter values remain the normative palette.

### Primary

- **Apple field** (`apple-field`): the income forecast, principal summaries, backup introduction, and legal title field.
- **Action yellow** (`action-yellow`, `action-hover`): primary buttons, current navigation, today's calendar date, and focused or hovered chart bars. Keep ink text on yellow.
- **Control green** (`control-green`): links, form caret, keyboard outlines, and selected calendar boundaries; this is separate from the brighter field.

### Secondary

- **Forest** (`forest`): allocation graphics and enabled switches.
- **Purple** (`purple`, `others-soft`, `others-ink`): Others ownership and savings-certificate cues.
- **Positive** (`positive`, `positive-soft`): received-payment status, always paired with text.
- **Red / overdue** (`red`, `overdue-soft`, `overdue-ink`): destructive actions and overdue status.

### Neutral

- **Paper** (`paper`): the main page ground.
- **Surface** (`surface`): contained forms and cards.
- **Ink / muted** (`ink`, `muted`): primary and supporting tracker text.
- **Line / soft** (`line`, `soft`): quiet separators, table headings, row hover, and selected secondary surfaces.
- **Field ink** (`field-ink`): text on apple-green surfaces; the field retains its light color in dark mode.
- **Legal copy / legal muted / legal rule** (`legal-copy`, `legal-muted`, `legal-rule`): the independent long-form reading surface.
- **Dark variants** (`dark-*`): the tracker changes its paper, surface, ink, muted, line, forest, control-green, soft, purple, red, and positive roles through `body.dark`. Yellow actions and the apple-green field retain their light-mode values. Legal pages remain light.

**The Field and Action Rule.** Green establishes an income or principal region; yellow identifies primary actions and current selections. Keep those roles distinct.

## Typography

**Display Font:** Manrope, with Nirmala UI, system-ui, and sans-serif fallbacks.  
**Body Font:** the same stack. The local variable font supplies weights (200–800), uses `font-display: swap`, and ships with `assets/fonts/OFL-Manrope.txt`.  
**Figures:** the same typeface with `font-variant-numeric: tabular-nums`.

**Character:** One family keeps headings, controls, and financial data coherent. Tight tracking belongs to headings and major values; ordinary copy and labels keep neutral spacing.

### Hierarchy

- **Display:** the frontmatter display role belongs to legal page titles. On phones it becomes `clamp(35px, 8vw, 46px)` with a (1.2) line height; at the narrowest legal breakpoint it becomes (33px).
- **Headline:** the tracker page title uses the headline role; below the mobile breakpoint it becomes (28px).
- **Title:** section headings use the title role. The income heading is slightly stronger (20px, 700); legal section headings use (23px, 750, 1.4), becoming (22px) on phones.
- **Metric:** the leading balance uses the metric role; secondary dashboard values use (30px). The income total uses (34px). Responsive values range from (24px) to (39px), depending on context and width.
- **Body:** tracker copy uses the body role; page descriptions use (13px, 1.7) and a maximum of (65ch). Legal prose uses the legal-body role and a maximum of (76ch).
- **Label:** field labels and important control labels use (12px); table headings use (11px) and sentence case in the redesigned dashboard. Supporting tracker annotations are generally (10–12px).
- **Button:** primary and secondary controls use the button role; top navigation and compact header actions use (11–12px).

**The Figure Rule.** Financial amounts use tabular figures and stronger scale before extra decoration. Keep currency, amount, and explanatory copy readable as one unit.

The small calendar annotations retained at narrow widths are compact component exceptions, not additional body or label roles to propagate to new screens.

## Layout

The tracker is centered at a maximum width of (1460px) with desktop horizontal gutters of (40px). The header is sticky and arranges brand, six destinations, and account actions in a single line. Above the menu breakpoint it has a compact minimum height of (78px). The spacing vocabulary is a collection of observed steps rather than an enforced mathematical scale.

The Dashboard uses an unboxed four-column balance strip, then a two-column work area with a (1.45fr / 1fr) split and (30px) gap. The first balance column is wider (1.25fr). A ruled deposit table and allocation track follow. Other working screens use contained cards, two-column forms, and context-specific grids.

At desktop widths (1161px and above), the Dashboard hides the redundant breadcrumb row. Its title and description share a baseline when space permits, the page-heading gap below is (14px), and the demo strip and balance strip use compact (18px) separations. This is a Dashboard density rule, not a requirement for every page title.

At those desktop widths with a viewport no taller than (800px), the forecast chart becomes (162px) tall with a plotting height of (114px). Planner rows use a minimum height of (61px) and vertical padding of (8px), keeping the complete four-payment planner in the initial screen. Bar height remains `max(2px, ratio × plot-height)` at every size.

### Responsive behavior

- **Large desktop (1600px and above):** chart height (218px), plotting height (166px), dashboard values (33px), leading value (39px); the short-desktop height rule still takes precedence when applicable.
- **Compact desktop (1300px and below):** horizontal app gutters become (30px), the main work gap becomes (24px), and figures reduce modestly.
- **Menu layout (1160px and below):** navigation becomes an off-canvas menu (300px wide, at most viewport minus 40px), with a scrim and visible close control. App gutters are (28px); holdings become two columns and the calendar becomes one column.
- **Intermediate (900px and below):** the work split becomes (1.25fr / 1fr); settings and backup stack; balance labels and figures tighten. The chart is (187px) tall with a (135px) plot.
- **Mobile (700px and below):** work areas stack in source order; balances become two columns. Gutters are (20px), chart height returns to (202px) with a (150px) plot, and the broad chart corner becomes (50px). Toolbars wrap and tabs can scroll. Supporting controls stay usable without scaling down the whole workspace.
- **Small mobile (500px and below):** the heading action wraps below the title, app gutters become (17px), holdings and modal form fields become one column, and the calendar keeps its seven-column structure. Below (360px), app gutters become (14px).
- **Wide tables:** the dashboard table has a minimum width of (850px) under the menu breakpoint and (800px) on mobile. Horizontal scrolling is confined to the table wrapper.

Legal pages use a separate centered wrapper: maximum (1272px), viewport minus (84px). A (250px) sticky contents column and reading column are separated by (74px). Above (1600px), the wrapper max becomes (1356px) and the gap (92px); below (1050px), gutters total (56px), contents become (220px), and the gap (42px). Below (760px), gutters total (40px), the header stacks, and contents become an expandable block before the text. Scroll offsets account for the sticky header. Print styling removes navigation and colored fields and gives the document a plain reading layout.

## Elevation & Depth

The working canvas relies on flat color fields, thin rules, and tonal state changes. Cards and primary buttons have no ambient shadow. Holding cards change surface and border color on hover without lifting. Only overlays, transient feedback, and small control affordances introduce physical depth.

### Shadow Vocabulary

- **Dialog:** `0 24px 70px #00000040`; its backdrop is `#18221177` with (4px) blur.
- **Toast:** `0 8px 24px #00000026`; the floating message uses a dark green surface.
- **Switch thumb:** `0 1px 3px #0002`, retained for the small movable control.
- **Menu scrim:** `#19241377` with (3px) blur; no card-like navigation shadow.

**The Flat Surface Rule.** Ordinary work surfaces and holding cards are flat. Reserve diffuse shadow and backdrop blur for overlays and transient feedback.

The root `--shadow` declaration and superseded legacy elevation values are not evidence that ordinary cards should use shadows.

## Shapes

The repeated language is modest rounded rectangles: inputs and segments (9px), buttons (10px), icon controls (12px), cards (14px), and dialogs (16px). Small status chips use (6px). Circles are reserved for avatars, status dots, and switch thumbs.

The broad lower-right corner gives green fields their signature: the income field uses the frontmatter four-corner value, backup introduction uses its own slightly smaller broad corner, and legal titles keep their other corners square. On mobile the legal corner reduces to (42px). Do not copy the broad field silhouette onto every control.

One-pixel borders and separators use the line role. Chart bars have rounded top corners (5px) and square bottoms. Original bank artwork stays on a white contained mark so each institution remains recognizable.

## Components

### Buttons

Direct, familiar controls with strong state visibility.

- Primary actions use yellow, ink text, the button radius, and a minimum height of (44px). Secondary controls use the surface role with a line border; danger actions use a red border and text.
- Hover changes color; active buttons move down (1px). The shared color transition is (180ms) with `cubic-bezier(.2,.8,.2,1)`.
- Keyboard focus uses a (3px) control-green outline offset by (4px). Disabled controls retain the base opacity of (0.5) and a not-allowed cursor.
- Text actions keep green text and underline on hover. Their compact planner variant uses a (36px) minimum height.

### Chips

Small, quiet text-bearing status cues.

- Status chips use the small radius, padding (5px 9px), and (11px) text.
- Received, Others, and overdue each pair a soft background with a contrasting semantic ink.
- The chip label communicates the state; a colored dot is supporting information.

### Cards / Containers

Cream containers subordinate to the open Dashboard.

- Ordinary cards use surface, a line border, card corners, and (26px) desktop padding; mobile card padding becomes (23px).
- Holding cards use (25px) padding and change to the soft surface with a green border on hover.
- The green income field is borderless. Its default padding is the component token; responsive and short-desktop refinements are in Layout.

### Inputs / Fields

Standard browser controls with explicit labels.

- Inputs, selects, and textareas use surface, ink, a line border, the input radius, padding (11px 12px), and a minimum height of (44px).
- Input text is (13px). Field labels use muted text; placeholder opacity remains (1) so the role retains contrast.
- Focus uses a (2px) green outline offset by (2px) and a green border. Carets use control green.
- Form errors and warning notices pair visible text with semantic surface changes. Forms use two columns with an (18px) gap, stacking at the small-mobile breakpoint.

### Navigation

Current position is carried by yellow.

- Desktop destinations are centered text controls; current state is a yellow rounded rectangle, inactive state is muted, and inactive hover uses soft.
- Below the menu breakpoint, destinations become full-width controls with inline SVG icons, (48px) minimum height, and (14px) text.
- Closed off-canvas navigation is hidden and does not receive pointer events. The open state, scrim, close button, and focus return keep menu state explicit.
- Legal navigation uses three text links and a pill-shaped current state; the contents list is sticky on desktop and expandable on mobile.

### Income field and chart

A functional green plotting surface with a broad lower-right corner.

- Six month controls share one scale, using alternating dark green bars. Each month has an accessible currency-and-month name.
- Pointer hover and keyboard focus reveal a dark tooltip and turn the bar yellow. Activating a month opens its payment calendar.
- Bars enter from the baseline over (650ms) using `cubic-bezier(.16,1,.3,1)`, staggered by (35ms). The data ratio remains exact when the plot height changes.
- Reduced-motion preference disables animations and transitions throughout the tracker.

### Payment rows

Ruled, horizontally aligned records with a date, deposit label, and right-aligned amount.

- The date block is open rather than boxed. The first upcoming item has a soft background and button-like rounded boundary (10px).
- Normal planner rows use a minimum height of (75px); compact desktop rows follow Layout. Supporting text gives payment kind and net/TDS context.
- Hover uses soft, and keyboard focus keeps the shared outline.

### Account identity

A photo or initials avatar with full name and explicit connection text.

- The name truncates in the compact header; detailed account information may wrap.
- Avatars are circular and photos use `object-fit: cover`; image failure falls back to initials.
- Compact identity and backup state remain separate pieces of information.

### Dialogs and feedback

Dialogs use the dialog radius, the overlay shadow, a sticky surface-colored header, and a width of `min(650px, 100% - 32px)` with a maximum height of (90dvh). Default header padding is (24px 28px), and body padding is (26px 28px), tightening on mobile. Toasts sit centered near the lower viewport edge and announce status through the live region.

## Do's and Don'ts

### Do:

- **Do** use the final redesign stylesheet after the base tracker stylesheet when extending the app.
- **Do** keep Dashboard navigation naming and the supplied Depositly logo, bank artwork, and publisher identity.
- **Do** preserve tabular figures, right-aligned amount columns, and explicit ownership or status text.
- **Do** keep visible focus outlines, semantic controls, and the reduced-motion treatment.
- **Do** stack working areas on phones and allow wide financial tables to scroll inside their container.
- **Do** use the distinct legal reading scale and responsive contents navigation for long documents.

### Don't:

- **Don't** flatten the entire interface into interchangeable green cards; the implemented hierarchy depends on cream space, rules, and a few substantial green fields.
- **Don't** use yellow for passive surface decoration; it carries action and selection meaning.
- **Don't** scale chart bars independently of their data ratio when the plot height changes.
- **Don't** replace actual account identity, demo identification, or backup state with decorative badges.
- **Don't** treat superseded sidebar styling, Inter typography, decorative eyebrows, or lifted holding cards in the legacy stylesheet as current design rules.

