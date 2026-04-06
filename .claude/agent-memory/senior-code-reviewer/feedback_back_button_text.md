---
name: Back button missing visible text label
description: Mobile nav back button uses aria-label but omits a visible text label, violating the icon-only accessibility rule
type: feedback
---

In the mobile top nav, the back button renders only a `<ChevronLeft>` icon. The project's `code-quality.md` rule explicitly states: "Pair icons with text labels or accessible tooltips — never rely on icons alone."

**Why:** `aria-label` satisfies screen readers but sighted users lose the "Back" label present in the previous implementation.

**How to apply:** Any icon-only button that isn't a clearly universal icon (e.g., a close X in a modal) must have a visible text sibling or a tooltip primitive from `src/components/ui/`.
