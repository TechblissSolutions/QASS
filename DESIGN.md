---
name: Sparrow by TechBliss
description: A warm, precise brand workspace for research and thoughtful content creation.
colors:
  techbliss-orange: "#f97316"
  orange-wash: "rgba(249, 115, 22, 0.13)"
  selected-surface: "#fff8f2"
  warm-canvas: "#f4f1ec"
  charcoal-ink: "#282522"
  sparrow-charcoal: "#24221f"
  muted-taupe: "#77716b"
  warm-divider: "#e4dfd8"
  white-surface: "#ffffff"
typography:
  display:
    fontFamily: "Inter, Segoe UI Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "31px"
    fontWeight: 750
    lineHeight: 1.12
    letterSpacing: "-0.04em"
  body:
    fontFamily: "Inter, Segoe UI Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  control: "10px"
  field: "11px"
  button: "12px"
  selection: "13px"
  surface: "16px"
  panel: "18px"
  feature: "24px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "48px"
components:
  button-primary:
    background: "#f97316"
    color: "#ffffff"
    rounded: "12px"
  button-secondary:
    background: "#ffffff"
    color: "#282522"
    rounded: "12px"
  text-field:
    background: "#ffffff"
    border: "#e4dfd8"
    rounded: "11px"
  content-panel:
    background: "#ffffff"
    border: "#e4dfd8"
    rounded: "18px"
  active-navigation:
    background: "#fff8f2"
    color: "#f97316"
  selected-channel:
    background: "rgba(249, 115, 22, 0.13)"
    color: "#f97316"
---

# Design System: Sparrow by TechBliss

## Direction

A warm, focused workspace with a quiet paper canvas, clear white working surfaces, charcoal text, and a confident TechBliss orange accent. The interface should feel composed and practical for sustained research and content work. Use contrast, spacing, and restrained depth to establish hierarchy; keep decorative effects secondary to the user's task.

## Theme ownership

Sparrow's shared interface uses the warm-neutral palette. A selected company's saved or discovered logo, colors, and background remain scoped to that company's workspace and content previews. `BrandTheme` provides the `--client-*` variables and contrast-aware foreground colors; workspace selection, project switching, and theme persistence remain the source of truth. Use company colors for contextual actions and selected states, and never replace them with Sparrow's orange.

## Color roles

- **Warm canvas** (`warm-canvas`): global page background and quiet areas around working surfaces.
- **White surface**: forms, panels, cards, dialogs, and other focused working areas.
- **Charcoal ink**: headings and primary reading text; use muted taupe for supporting labels.
- **TechBliss orange**: primary Sparrow actions, focus, progress, and active global navigation.
- **Orange wash**: selected Sparrow navigation and low-emphasis states.
- **Warm divider**: quiet boundaries between surfaces and groups.
- **Company accents**: use the active project's `--client-primary` and its contrast-aware foreground within the company workspace.

## Typography and layout

Use the existing Inter-led system font stack. Establish hierarchy with size, weight, line length, and spacing. Keep reading text comfortably scannable and headings balanced. The spacing rhythm is 4, 8, 12, 16, 24, 32, and 48px. Use compact corners for controls and more generous corners for working panels and feature surfaces.

## Interaction and motion

Controls use visible keyboard focus, explicit disabled/loading/error states, and short transitions that clarify interaction. Motion should support content arrival, selection, and schedule changes, while honoring `prefers-reduced-motion`; essential state is always conveyed without motion.

## Accessibility and responsive behavior

Preserve clear contrast, keyboard access, semantic labels, touch-sized controls, and responsive navigation. Tables may scroll horizontally when necessary rather than hiding important fields. Keep dialogs focused and dismissible through their existing interaction model. Company-specific foreground/background pairs must continue to use the contrast-aware values from `BrandTheme`.
