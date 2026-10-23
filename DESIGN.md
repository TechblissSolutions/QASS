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
    fontWeight: 760
    lineHeight: 1.02
    letterSpacing: "-0.055em"
  body:
    fontFamily: "Inter, Segoe UI Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
  label:
    fontFamily: "Inter, Segoe UI Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
  channel:
    fontFamily: "Inter, Segoe UI Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
  navigation:
    fontFamily: "Inter, Segoe UI Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 680
  action:
    fontFamily: "Inter, Segoe UI Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 750
  utility-action:
    fontFamily: "Inter, Segoe UI Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 750
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
    backgroundColor: "{colors.techbliss-orange}"
    textColor: "{colors.white-surface}"
    typography: "{typography.action}"
    rounded: "{rounded.button}"
    padding: "0 20px"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.white-surface}"
    textColor: "{colors.charcoal-ink}"
    typography: "{typography.utility-action}"
    rounded: "{rounded.pill}"
    padding: "7px 10px"
  text-field:
    backgroundColor: "{colors.white-surface}"
    textColor: "{colors.charcoal-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "13px 14px"
    height: "46px"
  content-panel:
    backgroundColor: "{colors.white-surface}"
    textColor: "{colors.charcoal-ink}"
    rounded: "{rounded.panel}"
    padding: "24px"
  active-navigation:
    backgroundColor: "{colors.orange-wash}"
    textColor: "{colors.white-surface}"
    typography: "{typography.navigation}"
    rounded: "9px"
    padding: "5px 4px"
    height: "48px"
  selected-channel:
    backgroundColor: "{colors.selected-surface}"
    textColor: "{colors.charcoal-ink}"
    typography: "{typography.channel}"
    rounded: "{rounded.selection}"
    padding: "8px"
    height: "58px"
---

# Design System: Sparrow by TechBliss

## Overview

**Creative North Star: "The Brand Foundry"**

Sparrow is a premium, intelligent creative workspace that turns company research and brand context into thoughtful, brand-aware marketing content. Editorial sophistication meets operational clarity: the interface should feel professional, warm, focused, and quietly distinctive without losing the precision needed to move from research to brand understanding, creation, review, and planning.

Warm neutral surfaces, refined Inter typography, precise layouts, and purposeful interaction give the workspace its character. TechBliss Orange identifies Sparrow and calls attention to important actions; company-specific colors and assets belong to the selected company's context, not to every Sparrow workspace. No specific visual anti-reference is confirmed. Avoid generic AI-dashboard aesthetics, excessive gradients, decorative clutter, and unnecessary animation.

**Key Characteristics:**
- Warm, near-white working surfaces grounded by a Warm Canvas background.
- Charcoal Ink navigation with clear contrast and distinct active states.
- TechBliss Orange used as a considered signal, with company themes scoped to their workspaces.
- Editorial hierarchy and generous breathing room within a practical, responsive workflow.
- Subtle depth and purposeful state changes instead of decoration for its own sake.

## Colors

The core workspace pairs a warm, quiet neutral foundation with a clear orange action signal; selected company themes remain contextual rather than becoming Sparrow's product palette.

### Primary
- **TechBliss Orange**: Sparrow's established product accent for primary actions, active states, and intentional highlights. In a selected company workspace, the implementation may apply that company's saved brand theme to company-context controls; keep Sparrow's identity distinct.
- **Orange Wash**: A low-opacity orange surface for active navigation cues, not a large decorative block.
- **Selected Surface**: A pale orange-tinted surface for selected channel choices.

### Neutral
- **Warm Canvas**: The soft, warm background for workspace pages.
- **Charcoal Ink**: Primary workspace text and high-contrast UI content.
- **Sparrow Charcoal**: Deep product chrome and dark surfaces.
- **Muted Taupe**: Supporting text; keep it legible and subordinate to primary content.
- **Warm Divider**: Quiet borders and separators between controls and surfaces.
- **White Surface**: Cards, panels, fields, and other working surfaces.

**The Contextual Brand Rule.** A company's saved logo, colors, and assets apply only in that company's context. Do not treat TechBliss as the default subject or brand for user work.

## Typography

**Display Font:** Inter (with Segoe UI Variable, Segoe UI, and system sans-serif fallbacks)  
**Body Font:** Inter (with Segoe UI Variable, Segoe UI, and system sans-serif fallbacks)

**Character:** One clear sans-serif voice keeps operational information easy to scan. Use scale, weight, line height, and spacing for an editorial hierarchy rather than introducing a decorative typeface.

### Hierarchy
- **Display** (weight 760, 31px, line-height 1.02): Sampled workspace page heading; keep it confident and compact.
- **Body** (weight 400, 14px): Main control, form, and reading text.
- **Label** (weight 600, 11px): Compact channel and field labels; preserve legibility and avoid relying on muted color alone.
- **Navigation** (weight 680, 10px in the sampled mobile bar): Short, secondary labels paired with clear icons and active-state contrast.

**The One-Voice Rule.** Preserve the existing Inter-led system stack. Establish hierarchy with restrained differences in size and weight, not decorative type or excessive weight variation.

## Layout

The workspace uses a company-scoped application shell around a focused content area. On wide screens, the company navigation is a persistent rail (228px); on the sampled narrow layout it becomes a fixed bottom navigation bar. Keep the task content readable and vertically ordered on small screens rather than compressing desktop controls.

Use the implemented spacing rhythm (4, 8, 12, 16, 24, 32, and 48px) to group related controls and separate workflow stages. White panels provide clear content groupings, with consistent internal padding and hierarchy. Keep navigation labels, controls, and primary actions recognizable at every viewport size.

## Elevation & Depth

The system is layered but restrained. Warm Canvas establishes the page plane; near-white panels, quiet borders, and subtle shadows distinguish the current working area. Dark navigation uses solid Charcoal Ink for contrast, not gradients. Shadows clarify the relation between cards or floating panels and their background; they should not make every element appear to float.

### Shadow Vocabulary
- **Working panel** (`0 8px 26px rgba(17, 24, 39, 0.05)`): Subtle separation for content panels such as the Studio brief.
- **Primary action** (`0 10px 22px rgba(249, 115, 22, 0.22)`): A restrained accent-colored lift for the main action only.
- **Selected channel** (`0 5px 15px rgba(249, 115, 22, 0.08)`): Light feedback accompanying the orange selection border.

**The Quiet Depth Rule.** Prefer surface tone and Warm Divider for ordinary structure; reserve shadows for meaningful separation or emphasis.

## Shapes

The form language is gently rounded and consistent, not pill-shaped by default. Controls use compact corners (10–12px); fields use an 11px radius; channel choices use a 13px radius; working panels use an 18px radius. Reserve pill corners for compact secondary actions that already use them. Borders are subtle and surfaces remain clean and uncluttered.

## Components

### Buttons
- **Shape:** Softly rounded, with comfortable targets (primary action: 12px radius and 48px high).
- **Primary:** TechBliss Orange with white text; sampled Studio action uses 14px, weight 750, and 20px horizontal padding.
- **Secondary / Ghost:** Neutral white surface and Warm Divider border; compact ghost actions use subdued type and pill corners.
- **Hover / Focus / Pressed:** Make each state apparent without changing the control's role. The sampled primary action darkens on hover; the global focus ring is a 3px orange-tinted outline with a 3px offset; pressed links and buttons scale slightly.
- **Disabled / Loading:** Preserve clear disabled and progress feedback; do not present an in-progress action as complete.

### Chips
- **Style:** Channel choices are compact, readable cards on White Surface, with a quiet Warm Divider when unselected.
- **State:** Selected choices use a restrained orange border and pale orange-tinted surface. Keep the label and state explicit, not color-only.

### Cards / Containers
- **Corner Style:** Working panels use an 18px radius; channel cards use 13px.
- **Background:** White Surface against Warm Canvas.
- **Shadow Strategy:** Use subtle ambient depth for panels and selected choices, not across every nested element.
- **Border:** Thin warm neutral border; avoid heavy outlines.
- **Internal Padding:** Follow the 16–32px spacing steps according to panel density.

### Inputs / Fields
- **Style:** White Surface with a subtle Warm Divider border and 11px corners. The sampled select is 46px high; textareas retain room for multi-line instructions.
- **Focus:** Visible orange-tinted keyboard focus treatment, with readable labels and helper text.
- **Error / Disabled:** Keep states distinct and textually understandable.

### Navigation
- **Style:** Solid Charcoal Ink workspace chrome with short, legible labels and simple icons.
- **Active:** A clear state with a precise orange cue; preserve the company-scoped navigation structure.
- **Responsive:** Persistent side rail on wide layouts; fixed bottom dock on the sampled mobile layout. Keep it clear of page actions and content.

## Do's and Don'ts

### Do:
- **Do** use TechBliss Orange for Sparrow-level primary actions and purposeful active states.
- **Do** scope company logos, colors, and brand assets to the selected company.
- **Do** keep Warm Canvas, White Surface, Charcoal Ink, and Warm Divider roles distinct.
- **Do** preserve working behavior, navigation, and the existing system type stack.
- **Do** retain visible keyboard focus, responsive layouts, sufficient contrast, and reduced-motion support.
- **Do** use restrained transitions to clarify interaction and feedback.

### Don't:
- **Don't** imply Sparrow is exclusively for TechBliss marketing.
- **Don't** apply a selected company's identity as Sparrow's global product identity.
- **Don't** add generic AI-dashboard motifs, excessive gradients, decorative clutter, or unnecessary animation.
- **Don't** make hierarchy depend on tiny muted labels, color alone, or heavy shadows.
- **Don't** replace working flows or introduce unsupported capabilities while extending the visual system.
