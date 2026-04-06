---
name: React.memo detection pattern
description: How to verify a component is memo-wrapped in vitest tests without DOM overhead
type: feedback
---

To assert a component is wrapped with `React.memo`, check its `$$typeof` symbol:

```ts
expect((MyComponent as any).$$typeof?.toString()).toContain('react.memo')
```

This is reliable across React 18/19. Do not try to spy on render counts to prove memoization — that requires a wrapper component and is fragile. The `$$typeof` check is the canonical unit-level assertion.

**Why:** React.memo wraps the component in an object whose `$$typeof` is `Symbol(react.memo)`. This is stable across React versions and does not require DOM rendering.

**How to apply:** Use this pattern any time a test needs to confirm `memo(...)` wrapping as part of a performance optimization test.
