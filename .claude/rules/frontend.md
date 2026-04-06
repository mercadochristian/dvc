# Frontend Rules

## File Scope
Covers: `.tsx`, `.jsx`, `.vue`, `.svelte`, `.css`, `.scss`, `.html` files and component/page/view/layout/style directories.

## Design Tokens (Mandatory)
"Before writing frontend code, find the project's existing tokens file" or create one. Avoid hardcoding values. Required categories: semantic colors (with dark mode), spacing scale, border radius, shadows (elevation), typography (fonts, scale, weights), breakpoints, transitions (durations, easing), z-index.

## Dark Mode First
**Always design and implement for dark mode first.** This is the primary design target. Light mode support should be considered secondary. When building components or pages:
- Start with dark mode colors and contrast
- Ensure all interactive elements, text, and imagery are legible in dark mode
- Test dark mode thoroughly before considering light mode variations
- Dark mode is not optional — it's the baseline expectation

## Design Principles
Select one primary approach:
- **Glassmorphism**: Overlays, modern dashboards
- **Neumorphism**: Settings panels, minimal controls
- **Brutalism**: Developer tools, editorial sites
- **Minimalism**: Portfolios, documentation, content-first
- **Maximalism**: Creative agencies, e-commerce
- **Claymorphism**: Playful apps, onboarding
- **Bento Grid**: Dashboards, feature showcases
- **Aurora/Mesh Gradients**: Landing pages, hero sections
- **Flat Design**: Mobile apps, system UI
- **Material Elevation**: Data-heavy apps, enterprise
- **Editorial**: Blogs, long-form content

## Framework Selection
Use existing project libraries—don't mix competing ones. Options provided for CSS, primitives, animation, charts, and icons.

## Layout Standards
**Mobile-first, scale beautifully.** Start with mobile (single column, stacked) and enhance progressively for larger screens:
- **Mobile (< 768px)**: Single column layouts, stacked components, full-width interfaces
- **Tablet (768px - 1024px)**: Two-column grids, optimized spacing
- **Desktop (≥ 1024px)**: Multi-column grids, expanded layouts, enhanced whitespace
- Use CSS Grid for 2D layouts, Flexbox for 1D alignment
- Use semantic HTML (`<nav>`, `<main>`, `<section>`, `<article>`)
- Minimum touch targets: 44×44px (mobile) — scale proportionally on desktop
- Test at actual device sizes to ensure readable text and accessible spacing across all breakpoints

## Accessibility Requirements
Keyboard navigation, meaningful alt text, associated labels, 4.5:1 contrast ratio, visible focus indicators, color-independent design, dynamic content updates, motion preferences respected.

## Performance
Lazy-load images, optimize fonts, use `transform`/`opacity` for animations, virtualize 100+ item lists, minimize bundle imports.

---

## Tailwind v4 Dark Mode Pattern

The project uses `@custom-variant dark (&:is(.dark *))` (defined in `src/app/globals.css` line 5). Dark mode is **class-based**, toggled by the `.dark` class on the document root.

- Use the `dark:` variant prefix: `bg-background dark:bg-muted`
- Always pair `dark:` with a base light variant — never write `dark:` alone
- Do **not** use `@media (prefers-color-scheme: dark)` for component styles — the project uses class-based switching, not system preference

## CSS Custom Property Tokens (Use these — never hardcode oklch/hex values)

These are defined in `src/app/globals.css` `:root` and `.dark` blocks. Use the Tailwind utility class, not the raw CSS variable, in component code.

| Token | Tailwind class | Use |
|-------|---------------|-----|
| `--background` | `bg-background` | Page background |
| `--foreground` | `text-foreground` | Primary text |
| `--card` | `bg-card` | Card surfaces |
| `--card-foreground` | `text-card-foreground` | Text on cards |
| `--popover` | `bg-popover` | Popover/dropdown backgrounds |
| `--muted` | `bg-muted` | Subdued backgrounds, hover states |
| `--muted-foreground` | `text-muted-foreground` | Placeholders, captions, secondary text |
| `--primary` | `bg-primary` | Primary action color |
| `--primary-foreground` | `text-primary-foreground` | Text on primary backgrounds |
| `--secondary` | `bg-secondary` | Secondary surfaces |
| `--accent` | `bg-accent` | Hover/selected states |
| `--accent-foreground` | `text-accent-foreground` | Text on accent backgrounds |
| `--destructive` | `text-destructive` / `bg-destructive` | Error/danger actions |
| `--border` | `border-border` | Borders |
| `--input` | `bg-input` | Form input backgrounds |
| `--ring` | `ring-ring` | Focus ring |
| `--radius` | `rounded-[var(--radius)]` | Base border radius (0.625rem) |
| `--sidebar` | `bg-sidebar` | Sidebar background |
| `--sidebar-foreground` | `text-sidebar-foreground` | Sidebar text |
| `--chart-1` through `--chart-5` | `bg-chart-1` etc. | Data visualization only |

If a new semantic color is needed, add it to `:root` and `.dark` in `globals.css` and reference it via a new token — do not hardcode the value in a component.

## Component Composition Order

1. **Use existing primitives in `src/components/ui/`** first: `Button`, `Card`, `Badge`, `Input`, `Label`, `Select`, `Dialog`, `Tabs`, `Table`, `Pagination`, `Alert`, `DropdownMenu`, `NavigationMenu`, `PageHeader`.
2. **Use Base UI primitives (`@base-ui/react`)** when an accessible headless component is needed but no styled version exists in `src/components/ui/`.
3. **Use native HTML** (`<button>`, `<input>`, `<select>`) only as a last resort or for a form element that needs no custom styling.
4. **Create a new component in `src/components/ui/`** only when the same styled pattern appears in 3 or more places. Until then, inline or use a local component.
