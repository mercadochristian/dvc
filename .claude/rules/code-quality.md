# Code Quality & Development Standards

## Forms & Validation

Define Zod schema in `src/lib/validations/`. Use React Hook Form with `zodResolver()`. Call Supabase methods in `handleSubmit()`.

```tsx
const { register, handleSubmit, formState: { errors }, reset } = useForm<FormData>({
  resolver: zodResolver(mySchema),
  defaultValues: { /* ... */ },
})
```

## UI Components & Accessibility

- Always add `cursor-pointer` to interactive elements (clickable cards, radio options, buttons with hover effects)
- Pair icons with text labels or accessible tooltips — never rely on icons alone
- Never rely on color alone to convey meaning — always pair with icons or text
- Ensure sufficient contrast for all text and interactive elements

**Button sizes:** `default`, `sm`, `xs`, or `icon`/`icon-sm`/`icon-lg` for square icon buttons.

**Button variants:** `default`, `outline`, `secondary`, `ghost`, `destructive`, `link`.

Example interactive element:
```jsx
<div
  onClick={() => setPosition(option.value)}
  className="p-3 cursor-pointer transition-colors hover:bg-muted"
>
  {/* content */}
</div>
```

## Client Components

Add `'use client'` directive to components using React hooks (useState, useEffect, useContext) or event handlers. Layouts wrapping AppShell don't need the directive.

## Notifications

Use Sonner for all toast notifications:

```ts
import { toast } from 'sonner'

toast.success('Operation successful')
toast.error('Operation failed')
```

## Animation Pattern

All staggered animations use a consistent `fadeUpVariants` object with `custom` prop for delay control:

```ts
const fadeUpVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (custom: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, delay: custom * 0.1 },
  }),
}
```

Apply with: `<motion.div custom={index} initial="hidden" animate="visible" variants={fadeUpVariants}>`

The `custom` prop controls stagger delay.

## Code Organization

- **Don't modify generated files** — `src/types/database.ts` is generated from Supabase. Edit the database schema directly.
- **Don't create single-use helpers** — Three identical lines of code is better than a premature abstraction.
- **Don't add unnecessary error handling** — Trust internal APIs and frameworks. Only validate at system boundaries (user input, external APIs).
- **Don't commit without tests** — New or modified functions must have unit tests.

## Development Mindset

**Do Not Assume — Always Ask:** When requirements are ambiguous, edge cases unclear, or implementation direction uncertain, ask a clarifying question before building. Better to pause 30 seconds than build the wrong thing.

**Keep it simple:** The right amount of complexity is the minimum needed for the current task. Don't design for hypothetical future requirements.

**Solve root causes:** When you encounter an obstacle, debug and fix the underlying issue rather than using shortcuts or bypassing safety checks.
