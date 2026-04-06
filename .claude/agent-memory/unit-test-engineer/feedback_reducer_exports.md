---
name: Export reducers and initial state for testability
description: Pure reducer functions and their initial state should be exported for unit testing without importing the full component
type: feedback
---

When a `useReducer` is defined inside a client component file, export the reducer function and `initialState` object separately (not the component). Tests can then import and exercise the pure reducer logic without needing to render or mock the full component tree.

Pattern used in `registrations-client.tsx`:
- `export { initialDialogState }` before the function
- `export function dialogReducer(...)` on the function declaration

**Why:** Client components have many dependencies (Supabase, routing, framer-motion) that are expensive to mock. Extracting the reducer as a named export allows pure function tests with zero mocking overhead.

**How to apply:** Any time a `useReducer` is added to a client component, export the reducer and initial state so they can be tested in isolation under `__tests__/[name]-reducer.test.ts`.
