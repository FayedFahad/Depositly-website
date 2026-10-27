---
name: Depositly app theme
description: The Android app's emerald, sage and lime identity adapted to the web workspace.
colors:
  primary: "#0f6a52"
  primary-second: "#14876a"
  primary-soft: "#e4f2ea"
  accent: "#d9f27a"
  canvas: "#f2f6f1"
  surface: "#ffffff"
  surface-subtle: "#f7faf6"
  ink: "#10261f"
  muted: "#566a62"
  line: "#e0e8e1"
  danger: "#b8392d"
  others: "#7248ad"
  dark-canvas: "#0a1511"
  dark-surface: "#13211b"
  dark-soft: "#1f3529"
  dark-primary: "#b9e08f"
  dark-ink: "#ecf5ee"
  dark-muted: "#a9bdb1"
  dark-line: "#263a30"
  dark-on-primary: "#0d2a1f"
typography:
  headline:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 750
    lineHeight: 1.35
  body:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  button:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 700
rounded:
  small: "12px"
  control: "14px"
  medium: "16px"
  bank-card: "20px"
  card: "22px"
  balance: "24px"
  dialog: "28px"
spacing:
  compact: "8px"
  control-block: "10px"
  inset: "16px"
  control-inline: "18px"
  grid: "24px"
  card: "26px"
components:
  button-primary:
    textColor: "{colors.surface}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
  button-primary-dark:
    textColor: "{colors.dark-on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "26px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
  nav-active:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
    rounded: "{rounded.control}"
  pill:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
    padding: "4px 10px"
---

# Design System: Depositly app theme

## Overview

**Creative North Star: "App theme parity"**

The website uses the existing Android app's identity: sage working surfaces, emerald actions, forest principal panels and lime accents. The desktop workspace remains a working deposit tracker with its established navigation, tables, filters and forms.

The normative theme is `assets/app-theme.css`, loaded after the component styles on the workspace and policy pages. Its reference is the Android Build 15 theme in `E:/Github/Depositly/app/assets/redesign.css`. Existing product behavior remains defined outside this visual system.

**Key Characteristics:**
- Sage surfaces and emerald actions in light mode.
- Deep green surfaces and lime actions in dark mode.
- One Manrope family for interface text, with tabular money figures.
- Rounded controls and a forest principal panel shared by balances and form previews.

## Colors

Primary color marks actions, selected controls and data series. Soft green distinguishes selections and grouped fields. Lime is the app accent and becomes the primary action color in dark mode. Purple identifies Others records; red retains error and destructive-action meaning.

Canvas, surface, text and border tokens switch together under `body.dark`. The dark theme rebinds aliases such as text, copy, link and success so inherited light values do not leak into dark surfaces. Bank and publisher artwork retain their original colors.

**The Theme Source Rule.** Extend the semantic properties in `assets/app-theme.css`; base-layer azure values are not the current palette.

## Typography

Use the bundled Manrope variable font with system sans fallbacks. Page titles use the headline role, reduced to 28px at the theme's 700px breakpoint. Section headings use the title role. Body text uses the body role; compact tables and secondary labels retain their established smaller sizes.

Money and tabular data use tabular numerals. Emphasis uses weight rather than another display face. Existing form-section labels are retained for compatibility, not prescribed as a new pattern.

## Layout

Keep the existing desktop sidebar and workspace grid. The sidebar begins at 256px; existing responsive rules narrow it and turn it into a drawer at 768px. Summary and work grids collapse through the established 1020px and mobile breakpoints. The theme does not substitute phone navigation for web navigation.

Use the evidenced 8px, 16px and 24px spacing rhythm alongside existing component insets. Cards use a 26px default inset. At 700px and below, calendar cards use 16px insets, a 4px cell gap and 60px minimum day height; dialogs retain the mobile sheet silhouette. Preserve the existing responsive table treatment.

At the same mobile breakpoint, the balance card spans the summary grid and the two secondary metrics share a row with 12px gaps, 16px insets and a 160px minimum height. Long monetary values wrap rather than being clipped.

## Elevation & Depth

Surface tint, fine borders and small green-tinted shadows separate working regions. Forest balance panels carry the stronger app gradient and a restrained lower shadow. Dark mode uses the corresponding black shadow tokens. The old animated border beam is hidden by the theme.

Focus uses a visible outline or the three-pixel theme ring. Controls use short state transitions; reduced motion removes the theme's button, card and navigation transitions and button scaling.

## Shapes

Controls use the control radius; grouped custom fields use the medium radius. Standard cards use the card radius, bank cards use the bank-card radius, and principal panels use the balance radius. Dialogs use the dialog radius on desktop and rounded top corners on mobile. Pills and logos retain their specific smaller rounding.

## Components

- **Buttons:** emerald gradient with white text in light mode; lime gradient with dark green text in dark mode. Existing padding and a minimum 44px target are retained. Hover colors remain readable; active feedback is a small scale change.
- **Inputs:** surface background, fine green border and the control radius. Focus uses the second brand color and theme ring. Custom payout and tenure groups use soft green backgrounds without changing their independent behavior.
- **Navigation:** quiet sidebar text, soft green active backgrounds and primary-colored active labels. Mobile uses the existing drawer. Account text stays readable against the sidebar in both themes.
- **Cards:** white or deep green working surfaces with fine borders and low elevation. Principal and form-preview panels use the same forest gradient in both modes, with white values and pale green labels.
- **Chips and segments:** soft backgrounds with primary text. Selected segments use the surface color; financial meanings remain encoded by their existing labels and semantic colors.
- **Calendar and bank details:** selected dates use primary color; today's numeral uses the matching on-primary text. Account and routing number groups use the soft surface while preserving exact values and copy controls.

## Do's and Don'ts

- **Do** preserve the supplied Depositly logo, bank artwork and publisher credit.
- **Do** use the shared theme properties for light and dark states, including hover and focus.
- **Do** retain the website's established working layouts and financial behavior.
- **Don't** introduce new azure accents from the superseded base styles.
- **Don't** turn legacy uppercase section labels into a new decorative heading convention.
- **Don't** replace exact financial text with decorative graphics or hide it to make a layout fit.
