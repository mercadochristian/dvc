# Error Handling Rules

## Scope
Applied to `src/api/**`, `src/services/**`, `**/controllers/**`, `**/routes/**`, and `**/handlers/**`.

## Core Requirements

**Error Classification**
- Use typed/custom error classes with error codes — not generic `Error("something went wrong")`.
- Classify errors by type: validation errors (400), authentication errors (401), authorization errors (403), not found (404), server errors (500).

**Error Visibility**
- Never swallow errors silently. Log or rethrow with added context about what operation failed.
- Always propagate errors up the call stack unless explicitly handled.
- Include correlation or request IDs in error logging when accessible.

**Promise Handling**
- Handle every rejected promise. No floating (unhandled) async calls.
- Use `.catch()` or try-catch with async-await to ensure all promises are handled.
- Don't suppress errors unless you have a specific reason documented in comments.

**HTTP Responses**
- Maintain consistent error response structure with appropriate status codes.
- Include error codes and user-friendly messages in API responses.
- Never expose stack traces, internal paths, or raw database errors in production responses.

**Retry Strategy**
- Implement exponential backoff for transient failures (network timeouts, rate limits).
- Immediately fail on validation and authentication errors without retry attempts.
- Document retry logic clearly in code comments.

**Observability**
- Log errors with full context: what operation was attempted, what input, what failed.
- Include request IDs for tracing errors across the system.
- Separate user-facing error messages from internal debug logs.
