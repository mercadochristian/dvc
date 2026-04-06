---
name: Hardcoded color values in new UI panels
description: Author uses hardcoded hex/Tailwind color names instead of design tokens in dark-mode-aware panels
type: feedback
---

Recurring pattern: new UI panels (e.g., register split panel shell) hard-code `bg-[#0f172a]` and `text-sky-400` instead of using CSS custom properties (`bg-background`, `bg-card`, `text-primary`) from the design token system.

**Why:** The project uses `@custom-variant dark (&:is(.dark *))` with CSS variables in `globals.css`. Hard-coded values bypass this system entirely, causing the panel to appear in light mode with a dark navy background regardless of the user's theme preference.

**How to apply:** Flag any use of raw hex values or utility color classes (`sky-400`, `slate-500`) in components that should adapt to the theme. Suggest the equivalent design token.
