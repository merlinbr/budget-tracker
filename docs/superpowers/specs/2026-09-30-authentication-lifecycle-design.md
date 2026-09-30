# Authentication lifecycle work package

Date: 2026-09-30
Status: design approved in conversation; written-spec review pending.
Origin: `docs/APP_REVIEW.md`, findings C4 and C6.

## Goal and scope

After authentication expiry and re-login, abandoned pages must not leave navigation/sign-out blocked or allow abandoned GET requests to clear the new authentication state. An older write's cleanup must not unblock a newer active write.

Included:
- Reproduce C4 and C6 deterministically before implementing their corrections.
- Replace the shared pending boolean with operation-owned, idempotent release.
- Migrate every production pending-service caller, including budgets.
- Complete destruction cleanup for page-owned account/category/transaction reads.
- Guard component-local write callbacks after destruction so they cannot start replacement reads, focus detached controls, announce success or navigate from an abandoned page.
- Focused regressions, changed-workflow browser checks and integrated verification.
- Update only C4/C6 evidence and the current project status after verification.

Excluded: C1/C2/C3/C5, draft-preservation improvements, confirmation-focus redesign, backend changes, deployment/network changes, CI, generic CRUD abstractions, a new auth/state framework and unrelated cleanup. No real household data is used.

## Existing flow and failure mechanisms

`PendingFormService` currently exposes a root-provided boolean and `setPending(boolean)`. Accounts, categories, transactions, budgets and Settings write this shared flag; the route deactivation guard and shell sign-out consume it.

The deactivation guard deliberately permits `/login` while a write is pending. Settings profile/password finalizers currently clear global pending only when their component is still alive. A separate request's 401 can destroy Settings first, leaving the global flag true when the write settles (C4, source-derived until reproduced).

Account/category list and detail subscriptions, plus transaction lookup and detail subscriptions, lack destruction cleanup. Their sequence counters prevent stale local assignments but run after the global interceptor has processed a 401. An old GET can therefore clear a newer login (C6, source-derived until reproduced). Transaction filtered-list subscriptions already use `switchMap` and `takeUntilDestroyed`; Settings/dashboard/budgets provide existing cleanup patterns.

## Approaches and decision

1. Patch only Settings finalizers. Smallest immediate diff, but does not prevent an old finalizer from clearing another operation's pending flag.
2. Operation-owned pending state in the existing service, plus existing Angular read-cleanup operators. Slightly broader caller migration; solves ownership once without introducing new infrastructure. **Chosen.**

An authentication-generation framework or global request manager is not necessary for these two findings. Do not suppress all 401 responses or replay mutations.

## Pending-operation contract

Keep `PendingFormService` and its read-only `pending()` signal for existing guard/shell consumers. Replace `setPending(boolean)` with:

```ts
begin(owner: DestroyRef): () => void
```

- Each call acquires one independent UI/navigation lock and returns its release callback.
- `pending()` is true exactly while at least one acquired, unreleased lock exists.
- Release is idempotent and affects only that acquisition.
- The owner destruction hook invokes that release even if the HTTP write has not settled.
- The write's `finalize` invokes the same release on success, error or unsubscribe.
- Settlement before destruction unregisters the destruction callback, avoiding accumulation on long-lived pages.
- A completed/destroyed operation's later release cannot decrement a newer operation's ownership or make the count negative.
- Call `begin` only from an alive component and before subscribing to its write.

A private active-operation count and a per-acquisition released flag are sufficient; no operation registry, exported token type or new dependency is required.

This lock is a UI ownership mechanism, not a server transaction lock. Destruction releases the abandoned page's navigation restriction, but **does not cancel, retry or roll back its write**. The write may still commit. Subsequent reads reflect the server's actual result.

## Write integration

Acquire a release callback for each account/category save/archive, transaction save/delete, budget save/remove/copy, and Settings profile/password mutation. Remove all production `setPending` calls rather than retaining a second ownership system.

Use `finalize(release)` for global cleanup independently of component-local state. Keep local pending/error/success updates only while the component is alive. Check destruction before any callback can refresh data, focus, announce success or navigate. Settings' normal successful password-change flow must still clear secret inputs and return to login with its existing notice.

Budgets' `beginWrite`/`endWrite` helpers may stay, but each request's finalizer must capture that request's release callback. It must not look up a mutable callback that could belong to a newer operation.

Do not attach destruction cancellation to mutation streams. Preserve current live-page validation, failed-save behavior and successful-write semantics. Shared `AuthService` side effects remain subject to existing authentication semantics; this package is not a guarantee against every possible delayed mutation/session race. If reproduction shows an additional authentication effect prevents C4/C6 acceptance, report and scope that specific correction rather than silently broadening into an auth rewrite.

## Read integration

Use `takeUntilDestroyed(this.destroyRef)` on:
- Accounts: `loadList` and `startEdit` HTTP GETs.
- Categories: `loadList` and `startEdit` HTTP GETs.
- Transactions: both `loadLookups` GETs and `startEdit` GET.

Retain transaction list `switchMap` cancellation and all existing request-sequence checks. Do not refactor HTTP services into page-lifetime owners; their consumers own cancellation.

A write callback from a destroyed page must not create a new GET using an already-destroyed owner. Guard callbacks before refresh calls, not only inside subscription handlers.

Leave `authInterceptor` behavior unchanged unless a narrowly reproduced C4/C6 failure requires otherwise. Cancelled GETs must not deliver their errors to it. A live current-session protected API 401 must still clear auth and redirect to login. Retain login/restoration endpoint exceptions.

## Acceptance and evidence

### C4 / ownership

1. With Settings mounted, leave a profile mutation outstanding; have a separate live protected request return 401 and actually destroy Settings via navigation.
2. Establish the current implementation's stuck pending flag after mutation settlement using a failing regression, not just a source assertion.
3. After correction, destruction releases the abandoned page's lock without unsubscribing its mutation. Test both profile and password finalizers with success/error settlement where applicable.
4. Re-login without reload; protected navigation and shell sign-out work while the old mutation is still outstanding and after it settles.
5. Start a newer operation after destroying the old owner. Settle the old mutation; the newer operation remains pending and navigation/sign-out remain blocked until its own release.
6. Normal pending writes still block protected navigation/sign-out; login navigation remains allowed. Repeated release and destroy-after-settlement are harmless.
7. No component-local callback from the abandoned page initiates a read, focus or navigation.

### C6 / reads

1. Reproduce an outstanding old-session GET surviving page destruction and returning 401 after re-login, clearing the new auth state in the current implementation.
2. For each affected page and read category listed above, capture outstanding requests, destroy the page and assert cancellation using `HttpTestingController`.
3. Verify cancellation for transaction filtered-list reads remains intact.
4. After navigation away, logout/re-login and release of the abandoned response, the new auth state remains authenticated.
5. A live current-session protected GET returning 401 still clears auth and navigates to login.
6. Existing stale-response sequencing and normal list/detail/lookup loading, retries and errors remain intact.

### Verification layers

Use installed Angular/Vitest HTTP testing and router tools for deterministic race ordering. Capture requests before destruction and assert their `cancelled` property; do not treat a synthetic flush of a cancelled request as a deliverable late response. Use deferred observables only when necessary to inspect finalizer ordering and continued mutation subscription.

Add focused Playwright coverage for user-visible re-login/navigation/sign-out and abandoned GET behavior at 390px and 1280px, using the existing disposable real-backend setup. Delay responses with explicit promises/events; no timing sleeps, mocked success responses or automatic mutation replay. Transport delay must not be described as a server rollback.

Run on the stable tree:
- `cd frontend && npm test -- --watch=false`
- `cd frontend && npm run build`
- `cd frontend && npx playwright test`
- `cd backend && python -m pytest -q`

Record actual command outcomes, browser coverage and remaining limits. Previously recorded suite totals are historical, not evidence for this work. If either race cannot be reproduced, record what was attempted and keep the relevant finding open rather than claiming a fix.

## Files and boundaries

Production changes are limited to:
- `frontend/src/app/core/pending-form.service.ts`
- `frontend/src/app/features/accounts/accounts.page.ts`
- `frontend/src/app/features/categories/categories.page.ts`
- `frontend/src/app/features/transactions/transactions.page.ts`
- `frontend/src/app/features/budgets/budgets.page.ts`
- `frontend/src/app/features/settings/settings.page.ts`

Tests cover the service, those feature pages, auth guard/interceptor and shell behavior. Extend existing specs where practical; create a focused pending-service spec and browser lifecycle spec only where they provide a distinct check.

After verification, update `docs/APP_REVIEW.md` and `state.md`. Preserve other findings and all deployment release gates. Leave pre-existing changes to deployment/handoff documents, Unraid guides and `.pi/` untouched. Stage/commit only files belonging to this package.

## Completion boundary

The work package closes only with reproduced failure evidence, passing regression checks and recorded integrated outcomes. It does not accept the MVP for production, authorize host/network operations or close any finding outside C4/C6.
