# Authentication Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close C4 and C6 with reproduced failure evidence: abandoned pages cannot leave navigation/sign-out blocked or let abandoned GETs invalidate a newer login.

**Architecture:** Keep the existing pending service, guards, HTTP services and authentication interceptor. Replace shared boolean writes with per-operation release callbacks bound to their component owner; finalize writes independently of component-local updates. Cancel page-owned reads with Angular's existing destruction operator, without cancelling or replaying mutations.

**Tech Stack:** Angular 22.1, TypeScript 6, RxJS 7.8, installed Vitest/Angular HTTP and router testing, Playwright, existing FastAPI/SQLite disposable browser backend. No new packages.

## Global Constraints

- Approved spec: `docs/superpowers/specs/2026-09-30-authentication-lifecycle-design.md` (written spec approved by the user).
- "No real household data is used."
- "Do not attach destruction cancellation to mutation streams."
- "Leave `authInterceptor` behavior unchanged unless a narrowly reproduced C4/C6 failure requires otherwise."
- "Excluded: C1/C2/C3/C5, draft-preservation improvements, confirmation-focus redesign, backend changes, deployment/network changes, CI, generic CRUD abstractions, a new auth/state framework and unrelated cleanup."
- "Leave pre-existing changes to deployment/handoff documents, Unraid guides and `.pi/` untouched. Stage/commit only files belonging to this package."
- Keep `pending()` and existing user-visible copy. Production API change: replace `setPending(boolean)` with `begin(owner: DestroyRef): () => void`.
- Reproduce the actual reported failure before the corresponding fix. Failure due to a missing new API is not evidence that C4/C6 reproduced.
- No blanket 401 suppression, timing sleeps, invented browser success responses, automatic mutation retries or claims that client cancellation rolls back a write.
- Commit commands below are execution checkpoints, not permission to stage unrelated working-tree files. Inspect staged paths before every commit.

---

## File map and task boundaries

| File | Responsibility / planned change |
|---|---|
| `frontend/src/app/core/pending-form.service.ts` | Operation count, idempotent release and owner-destruction cleanup |
| `frontend/src/app/core/pending-form.service.spec.ts` (new) | Ownership, overlap, idempotence and cleanup |
| `frontend/src/app/features/accounts/accounts.page.ts` | Migrate save/archive ownership; guard abandoned write callbacks; cancel list/detail GETs |
| `frontend/src/app/features/categories/categories.page.ts` | Migrate save/archive ownership; guard abandoned write callbacks; cancel list/detail GETs |
| `frontend/src/app/features/transactions/transactions.page.ts` | Migrate save/delete ownership; guard callbacks; cancel lookup/detail GETs, retain filtered-list cancellation |
| `frontend/src/app/features/budgets/budgets.page.ts` | Migrate save/remove/copy ownership without mutable release-callback lookup |
| `frontend/src/app/features/settings/settings.page.ts` | Independent global cleanup for profile/password; guard abandoned password-success callback |
| Existing specs beside the five feature pages | Lifecycle regressions and existing behavior preservation |
| `frontend/src/app/core/auth/auth.guard.spec.ts` | Replace legacy setup; retain login exception and navigation blocking |
| `frontend/src/app/core/auth/auth.interceptor.spec.ts` | Prove a live protected 401 still clears authentication and redirects |
| `frontend/src/app/core/auth/auth-lifecycle.spec.ts` (new) | Real router destruction, delayed writes, old reads, re-login and operation overlap |
| `frontend/src/app/layout/app-shell.spec.ts` (new) | Real sign-out handler blocked only by current operation ownership |
| `frontend/e2e/auth-lifecycle.spec.ts` (new) | Real-backend browser race workflows at desktop/phone sizes |
| `docs/APP_REVIEW.md`, `state.md` | Record actual C4/C6 closure evidence and verification limits |

No production changes to guards, shell, interceptor, auth service, backend or Playwright configuration are planned. If an unexpected race requires changing one, stop and identify the precise evidence and scope change.

Task 1 must migrate all pending callers together: leaving boolean and operation ownership mixed would invalidate the fix. Tasks 2 and 3 split read cleanup by feature boundary; they can be reviewed separately after Task 1. Task 4 strengthens consumer integration checks; Task 5 supplies real-browser evidence; Task 6 records integrated outcomes.

## Execution preparation

- [ ] Inspect `git status --short` and branch. Planning branch is `docs/authentication-lifecycle-plan`; unrelated deployment/handoff edits and untracked Unraid files were already present. Use an isolated worktree for implementation if desired, following the worktree skill; do not move or discard those changes.
- [ ] Read the approved spec and this plan. Confirm Node/Python requirements from `README.md`, available backend interpreter and existing frontend dependencies. Do not upgrade dependencies as part of this work.
- [ ] Stop local development servers before Playwright, which starts its own backend/frontend. Activate `backend/.venv`, or set `PYTHON` to its interpreter path. On Windows Bash use the interpreter's actual path, not a Linux `.venv/bin/python` assumption.
- [ ] Run baseline frontend tests and build; record actual output and any unrelated failures. A baseline failure is a diagnosis checkpoint, not permission to change scope.

```sh
cd frontend
npm test -- --watch=false
npm run build
```

Repository shell note: this workstation has command rewriting that can fail with `hypa: command not found`; `command env git ...` and `command env rg ...` worked during planning. This is a harness issue, not an app defect. Use the normal commands in environments without that issue.

## Task 1: Reproduce C4 and replace global pending ownership atomically

**Files:**
- Create: `frontend/src/app/core/pending-form.service.spec.ts`
- Create: `frontend/src/app/core/auth/auth-lifecycle.spec.ts`
- Modify: `frontend/src/app/core/pending-form.service.ts`
- Modify: all five feature-page production files in the file map
- Modify: `frontend/src/app/core/auth/auth.guard.spec.ts`
- Modify: `frontend/src/app/features/settings/settings.page.spec.ts`
- Test: existing account/category/transaction/budget specs; add the write-lifecycle checks below there

**Interfaces:**
- Consumes: Angular `DestroyRef.onDestroy(callback): () => void`, RxJS `finalize(callback)`, existing `AuthService`, guards and feature mutation services.
- Produces: `PendingFormService.begin(owner: DestroyRef): () => void`; existing `pending: Signal<boolean>` consumer behavior remains unchanged.
- Produces: every mutation captures its own release callback; dead component callbacks perform no UI/navigation/refresh work.

### 1.1 Reproduce Settings destruction through actual routing

- [ ] Create `auth-lifecycle.spec.ts` with a focused real-router setup. Use the real Settings component and real guards/interceptor, with empty protected destinations to avoid unrelated dashboard reads. Do not use a router navigation spy as the destruction proof.

The following setup and C4 regression are the starting content. Extend this same describe block in Task 4. Import `HttpClient` and `DestroyRef` later when those checks need them.

```ts
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { Router, provideRouter } from "@angular/router";
import { RouterTestingHarness } from "@angular/router/testing";
import { vi } from "vitest";

import { AuthService } from "./auth.service";
import { authInterceptor } from "./auth.interceptor";
import { authGuard, anonymousGuard, pendingFormGuard } from "./auth.guard";
import { PendingFormService } from "../pending-form.service";
import { SettingsPage } from "../../features/settings/settings.page";

@Component({ standalone: true, template: "<p>Destination</p>" })
class DestinationPage {}

const identity = {
  user: { id: 1, username: "user", displayName: "User" },
  household: { id: 10, name: "Household" },
};

function signIn(http: HttpTestingController, auth: AuthService): void {
  auth.login("user", "correct horse battery staple").subscribe();
  http.expectOne("/api/auth/csrf").flush(null);
  http.expectOne("/api/auth/login").flush(identity);
}

function finishSettingsReads(http: HttpTestingController): void {
  http.expectOne("/api/household").flush({
    id: 10, name: "Household",
    members: [{ id: 1, displayName: "User", role: "owner", isActive: true }],
  });
  http.expectOne((r) => r.url === "/api/accounts").flush([]);
  http.expectOne((r) => r.url === "/api/categories").flush([]);
}

describe("authentication lifecycle", () => {
  let http: HttpTestingController;
  let auth: AuthService;
  let pending: PendingFormService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([
          { path: "login", component: DestinationPage, canActivate: [anonymousGuard] },
          { path: "settings", component: SettingsPage,
            canActivate: [authGuard], canDeactivate: [pendingFormGuard] },
          { path: "accounts", component: DestinationPage,
            canActivate: [authGuard], canDeactivate: [pendingFormGuard] },
          { path: "categories", component: DestinationPage,
            canActivate: [authGuard], canDeactivate: [pendingFormGuard] },
        ]),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    pending = TestBed.inject(PendingFormService);
    signIn(http, auth);
  });

  afterEach(() => http.verify());

  it("releases a profile write when a separate 401 destroys Settings", async () => {
    const harness = await RouterTestingHarness.create("/settings");
    const settings = harness.routeDebugElement!.componentInstance as SettingsPage;
    // Capture this GET before submitting; leave it outstanding.
    const household = http.expectOne("/api/household");
    http.expectOne((r) => r.url === "/api/accounts").flush([]);
    http.expectOne((r) => r.url === "/api/categories").flush([]);
    settings.profileForm.controls.displayName.setValue("Pending name");
    settings.saveProfile();
    const write = http.expectOne({ method: "PATCH", url: "/api/users/me" });
    expect(pending.pending()).toBe(true);

    household.flush(null, { status: 401, statusText: "Unauthorized" });
    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe("/login"));
    // The router has replaced Settings, not just changed the auth signal.
    expect(harness.routeDebugElement!.componentInstance).toBeInstanceOf(DestinationPage);
    expect(write.cancelled).toBe(false);
    write.flush(null, { status: 422, statusText: "Unprocessable Entity" });
    expect(pending.pending()).toBe(false);

    signIn(http, auth);
    await harness.navigateByUrl("/accounts", DestinationPage);
    expect(TestBed.inject(Router).url).toBe("/accounts");
  });
});
```

- [ ] Run only that file before adding the new service API:

```sh
cd frontend
npm test -- --watch=false --include=src/app/core/auth/auth-lifecycle.spec.ts
```

Expected baseline: the router reaches login, the mutation stays subscribed, then `pending.pending()` remains true after settlement. Record that assertion failure as C4 reproduction. If routing/timing setup fails instead, repair the test setup first; do not count that as reproduced.

### 1.2 Add service contract tests

- [ ] Create a standalone owner component in `pending-form.service.spec.ts` and use real Angular destruction hooks. The service test should not fake ownership with the root injector's lifetime.

```ts
import { Component, DestroyRef, inject } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { vi } from "vitest";
import { PendingFormService } from "./pending-form.service";

@Component({ standalone: true, template: "" })
class OwnerComponent {
  readonly destroyRef = inject(DestroyRef);
}

describe("PendingFormService", () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [OwnerComponent] }));

  it("counts independent acquisitions and makes release idempotent", () => {
    const service = TestBed.inject(PendingFormService);
    const owner = TestBed.createComponent(OwnerComponent);
    expect(service.pending()).toBe(false);
    const first = service.begin(owner.componentInstance.destroyRef);
    const second = service.begin(owner.componentInstance.destroyRef);
    first();
    first();
    expect(service.pending()).toBe(true);
    second();
    second();
    expect(service.pending()).toBe(false);
    owner.destroy();
    expect(service.pending()).toBe(false);
  });

  it("releases a destroyed owner without allowing late cleanup to release a new owner", () => {
    const service = TestBed.inject(PendingFormService);
    const oldOwner = TestBed.createComponent(OwnerComponent);
    const releaseOld = service.begin(oldOwner.componentInstance.destroyRef);
    oldOwner.destroy();
    expect(service.pending()).toBe(false);
    const newOwner = TestBed.createComponent(OwnerComponent);
    const releaseNew = service.begin(newOwner.componentInstance.destroyRef);
    releaseOld();
    expect(service.pending()).toBe(true);
    releaseNew();
    expect(service.pending()).toBe(false);
  });

  it("unregisters the owner callback when an operation settles", () => {
    const service = TestBed.inject(PendingFormService);
    const owner = TestBed.createComponent(OwnerComponent);
    const ref = owner.componentInstance.destroyRef;
    const original = ref.onDestroy.bind(ref);
    const unregister = vi.fn();
    vi.spyOn(ref, "onDestroy").mockImplementation((callback) => {
      const remove = original(callback);
      return () => { unregister(); remove(); };
    });
    const release = service.begin(ref);
    release();
    release();
    expect(unregister).toHaveBeenCalledTimes(1);
    owner.destroy();
    expect(service.pending()).toBe(false);
  });
});
```

- [ ] Run the service spec and confirm failure is the missing `begin` API. Keep the earlier C4 symptom failure as the actual diagnosis evidence.

### 1.3 Implement the service and migrate every caller

- [ ] Replace the service with the minimal count/closure implementation:

```ts
import { DestroyRef, Injectable, computed, signal } from "@angular/core";

@Injectable({ providedIn: "root" })
export class PendingFormService {
  private readonly count = signal(0);
  readonly pending = computed(() => this.count() > 0);

  begin(owner: DestroyRef): () => void {
    this.count.update((count) => count + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      unregister();
      this.count.update((count) => count - 1);
    };
    const unregister = owner.onDestroy(release);
    return release;
  }
}
```

`begin` is called only from a live component. The closure executes after `onDestroy` registration returns. Do not introduce a registry, UUIDs, token interfaces, or a public reset method.

- [ ] Accounts/categories: inject `DestroyRef`; import RxJS `finalize`. For both `save` and `confirmArchive`, acquire a local `release`, attach `finalize(release)`, remove every `setPending` call, and make `if (this.destroyRef.destroyed) return;` the first statement in both response callbacks. Retain live-page local state updates and messages.

Exact account save subscription shape (retain its existing validation and `body`/`write` construction):

```ts
const release = this.pendingForms.begin(this.destroyRef);
write.pipe(finalize(release)).subscribe({
  next: () => {
    if (this.destroyRef.destroyed) return;
    this.isSubmitting.set(false);
    this.formOpen.set(false);
    this.editingAccount.set(null);
    this.announcement.set(original ? "Account updated." : "Account saved.");
    this.loadList("Saved, but the account list could not be refreshed.");
  },
  error: (error: unknown) => {
    if (this.destroyRef.destroyed) return;
    this.isSubmitting.set(false);
    this.applyServerError(error, "Could not save account.");
  },
});
```

Exact category save subscription shape (retain its existing validation and `editing`/`write` construction):

```ts
const release = this.pendingForms.begin(this.destroyRef);
write.pipe(finalize(release)).subscribe({
  next: () => {
    if (this.destroyRef.destroyed) return;
    this.isSubmitting.set(false);
    this.formOpen.set(false);
    this.editingCategory.set(null);
    this.announcement.set(editing ? "Category updated." : "Category saved.");
    this.loadList("Saved, but the category list could not be refreshed.");
  },
  error: (error: unknown) => {
    if (this.destroyRef.destroyed) return;
    this.isSubmitting.set(false);
    this.applyServerError(error, "Could not save category.");
  },
});
```

For archive handlers use `this.accountsService.archive(target.id).pipe(finalize(release))` / `this.categoriesService.archive(target.id).pipe(finalize(release))`; keep their live-page archived-row cleanup, refresh, errors and existing focus behavior. Guard before all those statements. Do not fix C2/C3 here.

- [ ] Transactions: reuse its existing `destroyRef`. Add `finalize` to the RxJS imports. Apply the same per-request acquisition to save and delete:

```ts
const release = this.pendingForms.begin(this.destroyRef);
request.pipe(finalize(release)).subscribe({
  next: (saved) => {
    if (this.destroyRef.destroyed) return;
    this.savePending.set(false);
    this.formOpen.set(false);
    this.editingTransaction.set(null);
    const action = original ? "updated" : "saved";
    this.announcement.set(`Transaction ${action}.${this.matchesFilters(saved) ? "" : " It may be hidden by the current filters."}`);
    this.refreshAfterSave = true;
    this.loadLookups();
    this.filterRequests.next(this.currentFilters);
  },
  error: (error: unknown) => {
    if (this.destroyRef.destroyed) return;
    this.savePending.set(false);
    this.applyServerError(error, "Could not save transaction.");
  },
});
```

Delete must capture its own `release` and use `this.transactionsService.remove(target.id).pipe(finalize(release))`. Guard both callbacks before local updates, 404 refresh, lookup refresh and focus calls. Keep the existing messages and deletion semantics.

- [ ] Settings: acquire release separately in `saveProfile` and `changePassword`. Its finalizer releases unconditionally, with local pending flags guarded separately:

```ts
const release = this.pendingForms.begin(this.destroyRef);
this.auth.updateDisplayName(displayName).pipe(
  finalize(() => {
    release();
    if (!this.destroyRef.destroyed) this.savingProfile.set(false);
  }),
).subscribe({
  next: (user) => {
    if (this.destroyRef.destroyed) return;
    const state = this.householdState();
    if (state.kind === "ready") {
      this.householdState.set({
        kind: "ready",
        details: {
          ...state.details,
          members: state.details.members.map((member) =>
            member.id === user.id ? { ...member, displayName: user.displayName } : member,
          ),
        },
      });
    }
    this.profileError.set(null);
    this.profileAnnouncement.set("Profile saved.");
  },
  error: (error: unknown) => {
    if (this.destroyRef.destroyed) return;
    this.profileError.set(this.errorMessage(error, "Could not save profile."));
  },
});
```

For password change use this exact finalizer and begin acquisition:

```ts
const release = this.pendingForms.begin(this.destroyRef);
this.auth.changePassword(currentPassword, newPassword).pipe(
  finalize(() => {
    release();
    if (!this.destroyRef.destroyed) this.changingPassword.set(false);
  }),
).subscribe({
  next: () => {
    if (this.destroyRef.destroyed) return;
    this.passwordForm.reset();
    void this.router.navigate(["/login"], { state: { passwordChanged: true } });
  },
  error: (error: unknown) => {
    if (this.destroyRef.destroyed) return;
    if (error instanceof HttpErrorResponse &&
        typeof error.error?.error?.fields?.currentPassword === "string") {
      this.passwordFieldError.set(error.error.error.fields.currentPassword);
    }
    this.passwordError.set(this.errorMessage(error, "Could not change password."));
  },
});
```

Do not add `takeUntilDestroyed` to these writes. Existing shared `AuthService` password-success session clearing stays intact. Test late password success without asserting a newer session survives a server-confirmed password revocation; that would exceed the approved scope.

- [ ] Budgets: return a per-operation callback from the helper rather than storing a mutable release field:

```ts
private beginWrite(): () => void {
  this.writeError.set(null);
  this.pending.set(true);
  const release = this.pendingForms.begin(this.destroyRef);
  return () => {
    release();
    if (!this.destroyRef.destroyed) this.pending.set(false);
  };
}
```

Remove `endWrite`. In all three mutation handlers use `const finish = this.beginWrite();` followed by `pipe(finalize(finish))`. Add a destruction guard to their error callbacks; `saved` already checks destruction. Keep `copyPrevious`'s 409 confirmation behavior and its existing focus helper.

- [ ] Migrate legacy test setup: remove `pendingForms.setPending(false)` from Settings `beforeEach` (TestBed creates a fresh service). In `auth.guard.spec.ts`, import `Component`, `DestroyRef`, and `inject`, declare the owner below, add `imports: [GuardOwner]` to the pending-guard test's TestBed configuration and acquire a real owner lock. Retain both `/login` allowed and protected destination denied assertions. Do not leave a compatibility `setPending` API.

```ts
@Component({ standalone: true, template: "" })
class GuardOwner { readonly destroyRef = inject(DestroyRef); }

// In the pending-guard test, after its TestBed configuration:
const owner = TestBed.createComponent(GuardOwner);
const pending = TestBed.inject(PendingFormService);
const release = pending.begin(owner.componentInstance.destroyRef);
expect(TestBed.runInInjectionContext(() => pendingFormGuard(
  {} as never, {} as never, {} as never, { url: "/accounts" } as never,
))).toBe(false);
expect(TestBed.runInInjectionContext(() => pendingFormGuard(
  {} as never, {} as never, {} as never, { url: "/login" } as never,
))).toBe(true);
release();
expect(TestBed.runInInjectionContext(() => pendingFormGuard(
  {} as never, {} as never, {} as never, { url: "/accounts" } as never,
))).toBe(true);
```

### 1.4 Prove all migrated writes survive destruction safely

- [ ] Add Settings tests for profile success/422 after fixture destruction and password success/422 after destruction. Capture each write before destruction, assert `write.cancelled === false`, global pending false on destruction and after settlement; use `vi.spyOn(router, "navigate")` to assert a dead password-success callback does not navigate. Live-page successful password clearing/navigation tests already exist and must remain green.

Concrete Settings profile test, using existing `readyHousehold`, `fixture`, `http` and `pendingForms`:

```ts
it.each([200, 422])("releases an abandoned profile write on %s without cancelling it", (status) => {
  readyHousehold();
  fixture.componentInstance.profileForm.controls.displayName.setValue("Pending name");
  fixture.componentInstance.saveProfile();
  const write = http.expectOne({ method: "PATCH", url: "/api/users/me" });
  expect(pendingForms.pending()).toBe(true);
  fixture.destroy();
  expect(pendingForms.pending()).toBe(false);
  expect(write.cancelled).toBe(false);
  if (status === 200) {
    write.flush({ id: 1, username: "merlin", displayName: "Pending name" });
  } else {
    write.flush(null, { status: 422, statusText: "Unprocessable Entity" });
  }
  expect(pendingForms.pending()).toBe(false);
  http.expectNone((r) => r.method === "GET");
});
```

- [ ] Add one compact parameterized destruction test per remaining feature covering each write entry point. Use the existing fixture and HTTP utilities; capture the mutation before destroying the fixture. Required cases are specified below, including actual setup and endpoint:

| Page / case | Setup and action | Expected write / successful response |
|---|---|---|
| Accounts create | `startAdd(); form.controls.name.setValue("Pending"); save()` | POST `/api/accounts`, existing `row` with name `Pending` |
| Accounts archive | `beginArchive(row); confirmArchive()` | POST `/api/accounts/1/archive`, null |
| Categories create | `startAdd(); form.controls.name.setValue("Pending"); save()` | POST `/api/categories`, existing `row` with name `Pending` |
| Categories archive | `beginArchive(row); confirmArchive()` | POST `/api/categories/1/archive`, null |
| Transactions create | Flush lookups and list; `save({ accountId: 1, categoryId: 1, amount: -100, description: "Pending", transactionDate: "2026-09-07" })` | POST `/api/transactions`, transaction response below |
| Transactions delete | Flush lookups and list; `beginDelete(transaction); confirmDelete()` | DELETE `/api/transactions/1`, null |
| Budgets upsert | `ready(); click("Set limit", row()); enter("1.00"); submit()` | PUT `/api/budgets/3`, `{ ...baseBudget, limitAmount: 100 }` |
| Budgets remove | `ready([baseBudget]); click("Remove budget", row()); click("Confirm removal")` | DELETE `/api/budgets/3`, null |
| Budgets copy | `ready(); fixture.componentInstance.copyPrevious()` | POST `/api/budgets/copy-previous`, `[]` |

Transaction response used by these tests:

```ts
const transaction = {
  id: 1, accountId: 1, categoryId: 1, amount: -100, description: "Pending",
  transactionDate: "2026-09-07",
  createdAt: "2026-09-07T00:00:00Z", updatedAt: "2026-09-07T00:00:00Z",
};
```

For each case assert this sequence (use the endpoint from the table):

```ts
const pending = TestBed.inject(PendingFormService);
expect(pending.pending()).toBe(true);
fixture.destroy();
expect(write.cancelled).toBe(false);
expect(pending.pending()).toBe(false);
write.flush(response);
expect(pending.pending()).toBe(false);
http.expectNone((r) => r.method === "GET");
```

Run the same cases with a 422 mutation error (`write.flush(null, { status: 422, statusText: "Unprocessable Entity" })`), asserting no replacement reads. This catches dead success/error callbacks independently of ownership cleanup. Use installed test helpers, not a new cross-feature fixture library.

### 1.5 Verify and commit the ownership deliverable

- [ ] Search all callers and confirm the obsolete setter is gone:

```sh
rg -n 'setPending' frontend/src/app
rg -n 'begin\(|finalize|destroyRef.destroyed' frontend/src/app/core/pending-form.service.ts frontend/src/app/features
```

Expected: no `setPending` matches; every financial/settings mutation has independent finalize cleanup. Read all touched mutation handlers, not just matching lines.

- [ ] Run frontend unit suite and build. C4 reproduction, ownership tests and existing workflows must pass; no new production read-cancellation behavior is claimed yet.

```sh
cd frontend
npm test -- --watch=false
npm run build
```

- [ ] Commit only the service, listed feature files and changed/new tests. Use explicit paths from the file map, inspect `git diff --cached --stat`, then:

```sh
git commit -m "fix: make pending writes release their own navigation locks"
```

## Task 2: Reproduce C6 and cancel account/category reads

**Files:**
- Modify/test: `frontend/src/app/features/accounts/accounts.page.ts`, `accounts.page.spec.ts`
- Modify/test: `frontend/src/app/features/categories/categories.page.ts`, `categories.page.spec.ts`

**Interfaces:**
- Consumes: existing `DestroyRef` from Task 1; `takeUntilDestroyed(owner)`.
- Produces: page destruction unsubscribes both list and detail GETs, so their 401 errors cannot reach the interceptor after a new login.
- Preserve: existing list/detail sequence counters, archived behavior, Retry, current-session error handling and live-page writes.

### 2.1 Add a regression that demonstrates the stale-session effect

- [ ] In Accounts spec, import `withInterceptors`, `AuthService`, `authInterceptor`, `provideRouter`, and a standalone empty destination component. Keep normal tests; add HTTP interceptor and router providers to its existing TestBed setup. Sign-in can happen inside this one regression (the initial account read in `beforeEach` is already flushed).

```ts
it("cancels an abandoned account GET before it can clear a newer login", () => {
  const auth = TestBed.inject(AuthService);
  const identity = {
    user: { id: 1, username: "user", displayName: "User" },
    household: { id: 10, name: "Household" },
  };
  const login = () => {
    auth.login("user", "correct horse battery staple").subscribe();
    http.expectOne("/api/auth/csrf").flush(null);
    http.expectOne("/api/auth/login").flush(identity);
  };
  login();
  fixture.componentInstance.loadList();
  const abandoned = http.expectOne((r) => r.url === "/api/accounts");
  fixture.destroy();

  auth.logout().subscribe();
  http.expectOne("/api/auth/csrf").flush(null);
  http.expectOne("/api/auth/logout").flush(null);
  login();
  // Baseline delivers the real HttpClient error through the interceptor.
  // Corrected code must not attempt to flush a cancelled request.
  if (!abandoned.cancelled) {
    abandoned.flush(null, { status: 401, statusText: "Unauthorized" });
  }
  expect(auth.authState()).toEqual(identity);
  expect(abandoned.cancelled).toBe(true);
});
```

Add this file-local destination declaration (import `Component` from `@angular/core`); it is not imported from another test file:

```ts
@Component({ standalone: true, template: "" })
class DestinationPage {}
```

Provider changes are explicit:

```ts
provideHttpClient(withInterceptors([authInterceptor])),
provideHttpClientTesting(),
provideRouter([{ path: "login", component: DestinationPage }]),
```

- [ ] Run this test file before read changes. Expected symptom failure: the newer `authState()` becomes null when the abandoned GET receives 401. Record that as C6 reproduction. No database/network mocks are needed for this unit-level ordering proof.

```sh
cd frontend
npm test -- --watch=false --include=src/app/features/accounts/accounts.page.spec.ts
```

### 2.2 Cover list and detail cancellation on both pages

- [ ] Append these tests in their existing describe blocks:

```ts
// Accounts spec: existing beforeEach has finished its initial read.
it("cancels account list and detail GETs on destruction", () => {
  fixture.componentInstance.loadList();
  const list = http.expectOne((r) => r.url === "/api/accounts");
  fixture.componentInstance.startEdit(row);
  const detail = http.expectOne("/api/accounts/1");
  fixture.destroy();
  expect(list.cancelled).toBe(true);
  expect(detail.cancelled).toBe(true);
});
```

```ts
// Categories spec: existing beforeEach has finished its initial read.
it("cancels category list and detail GETs on destruction", () => {
  fixture.componentInstance.loadList();
  const list = http.expectOne((r) => r.url === "/api/categories");
  fixture.componentInstance.startEdit(row);
  const detail = http.expectOne("/api/categories/1");
  fixture.destroy();
  expect(list.cancelled).toBe(true);
  expect(detail.cancelled).toBe(true);
});
```

Capture requests before destruction so `http.verify()` can remain strict. Do not use `verify({ ignoreCancelled: true })` to conceal forgotten requests.

- [ ] Run both specs and confirm cancellation assertions fail before implementation.

### 2.3 Apply existing Angular read cleanup

- [ ] Import `takeUntilDestroyed` from `@angular/core/rxjs-interop` in accounts/categories. Add it to the list and detail subscriptions only:

```ts
// Replace Accounts loadList; request sequencing is unchanged.
loadList(refreshMessage?: string): void {
  const request = ++this.listRequest;
  this.isLoading.set(true);
  this.listError.set(null);
  this.accountsService.list(this.includeArchived()).pipe(
    takeUntilDestroyed(this.destroyRef),
  ).subscribe({
    next: (rows) => { if (request === this.listRequest) this.accounts.set(rows); },
    error: (error: unknown) => {
      if (request !== this.listRequest) return;
      this.isLoading.set(false);
      this.listError.set(refreshMessage
        ? `${refreshMessage} ${this.errorMessage(error, "Retry the refresh.")}`
        : this.errorMessage(error, "Could not load accounts."));
    },
    complete: () => { if (request === this.listRequest) this.isLoading.set(false); },
  });
}

// Replace Accounts startEdit.
startEdit(account: Account): void {
  this.saveError.set(null);
  this.announcement.set(null);
  this.fieldErrors.set({});
  const request = ++this.detailRequest;
  this.accountsService.get(account.id).pipe(
    takeUntilDestroyed(this.destroyRef),
  ).subscribe({
    next: (detail) => {
      if (request !== this.detailRequest) return;
      if (detail.isArchived) {
        this.formOpen.set(false);
        this.editingAccount.set(null);
        this.saveError.set("That account is archived and read-only.");
        this.loadList();
        return;
      }
      this.editingAccount.set(detail);
      this.formOpen.set(true);
      this.form.reset({ name: detail.name, type: detail.type,
        initialBalance: signedMoneyInput(detail.initialBalance), acknowledgeBalanceChange: false });
    },
    error: (error: unknown) => {
      if (request !== this.detailRequest) return;
      this.saveError.set(this.errorMessage(error, "That account is no longer available."));
      this.loadList();
    },
  });
}
```

```ts
// Replace Categories loadList.
loadList(refreshMessage?: string): void {
  const request = ++this.listRequest;
  this.isLoading.set(true);
  this.listError.set(null);
  this.categoriesService.list(this.includeArchived()).pipe(
    takeUntilDestroyed(this.destroyRef),
  ).subscribe({
    next: (rows) => { if (request === this.listRequest) this.categories.set(rows); },
    error: (error: unknown) => {
      if (request !== this.listRequest) return;
      this.isLoading.set(false);
      this.listError.set(refreshMessage
        ? `${refreshMessage} ${this.errorMessage(error, "Retry the refresh.")}`
        : this.errorMessage(error, "Could not load categories."));
    },
    complete: () => { if (request === this.listRequest) this.isLoading.set(false); },
  });
}

// Replace Categories startEdit.
startEdit(category: Category): void {
  this.saveError.set(null);
  this.announcement.set(null);
  this.fieldErrors.set({});
  const request = ++this.detailRequest;
  this.categoriesService.get(category.id).pipe(
    takeUntilDestroyed(this.destroyRef),
  ).subscribe({
    next: (detail) => {
      if (request !== this.detailRequest) return;
      if (detail.isArchived) {
        this.formOpen.set(false);
        this.editingCategory.set(null);
        this.saveError.set("That category is archived and read-only.");
        this.loadList();
        return;
      }
      this.editingCategory.set(detail);
      this.formOpen.set(true);
      this.form.reset({ name: detail.name, type: detail.type });
    },
    error: (error: unknown) => {
      if (request !== this.detailRequest) return;
      this.saveError.set(this.errorMessage(error, "That category is no longer available."));
      this.loadList();
    },
  });
}
```

Keep these touched methods readable. Do not convert this into a generic CRUD stream helper.

- [ ] Preserve sequence behavior with these stale-detail tests. Sequence checks remain necessary; destruction cancellation is not supersession cancellation.

```ts
// Accounts spec, using its existing row constant.
it("keeps the newer account detail when the old response arrives last", () => {
  const newer = { ...row, id: 2, name: "Newer account" };
  fixture.componentInstance.startEdit(row);
  const oldRequest = http.expectOne("/api/accounts/1");
  fixture.componentInstance.startEdit(newer);
  const newRequest = http.expectOne("/api/accounts/2");
  newRequest.flush(newer);
  oldRequest.flush(row);
  expect(fixture.componentInstance.editingAccount()?.id).toBe(2);
  expect(fixture.componentInstance.form.controls.name.value).toBe("Newer account");
});
```

```ts
// Categories spec, using its existing row constant.
it("keeps the newer category detail when the old response arrives last", () => {
  const newer = { ...row, id: 2, name: "Newer category" };
  fixture.componentInstance.startEdit(row);
  const oldRequest = http.expectOne("/api/categories/1");
  fixture.componentInstance.startEdit(newer);
  const newRequest = http.expectOne("/api/categories/2");
  newRequest.flush(newer);
  oldRequest.flush(row);
  expect(fixture.componentInstance.editingCategory()?.id).toBe(2);
  expect(fixture.componentInstance.form.controls.name.value).toBe("Newer category");
});
```

### 2.4 Verify and commit

- [ ] Run both focused files and build, then commit their four files explicitly:

```sh
cd frontend
npm test -- --watch=false --include=src/app/features/accounts/accounts.page.spec.ts --include=src/app/features/categories/categories.page.spec.ts
npm run build
```

```sh
git add frontend/src/app/features/accounts/accounts.page.ts frontend/src/app/features/accounts/accounts.page.spec.ts frontend/src/app/features/categories/categories.page.ts frontend/src/app/features/categories/categories.page.spec.ts
git diff --cached --check
git commit -m "fix: cancel abandoned account and category reads"
```

## Task 3: Complete transaction read cleanup without changing filtered-list behavior

**Files:**
- Modify: `frontend/src/app/features/transactions/transactions.page.ts`
- Test: `frontend/src/app/features/transactions/transactions.page.spec.ts`

**Interfaces:**
- Consumes: existing transaction `destroyRef`, lookup/detail sequence counters and filtered-list `switchMap` pipeline.
- Produces: destruction cancels account lookup, category lookup and transaction detail GETs; existing list cancellation remains unchanged.

### 3.1 Add a failing cancellation check

- [ ] Add this test to the existing transaction describe block, whose initial GETs are still outstanding:

```ts
it("cancels lookup, detail and filtered-list GETs on destruction", () => {
  const accounts = http.expectOne((r) => r.url === "/api/accounts");
  const categories = http.expectOne((r) => r.url === "/api/categories");
  const list = initialTransactions();
  const transaction = {
    id: 1, accountId: 1, categoryId: 1, amount: -100, description: "Pending",
    transactionDate: "2026-09-07",
    createdAt: "2026-09-07T00:00:00Z", updatedAt: "2026-09-07T00:00:00Z",
  };
  fixture.componentInstance.startEdit(transaction);
  const detail = http.expectOne("/api/transactions/1");
  fixture.destroy();
  expect(list.cancelled).toBe(true);
  expect(accounts.cancelled).toBe(true);
  expect(categories.cancelled).toBe(true);
  expect(detail.cancelled).toBe(true);
});
```

- [ ] Run the transaction spec before implementation. Expect list cancellation already passes, lookup/detail cancellation fails. Record this sibling-path evidence separately from C6's account reproduction.

### 3.2 Fix only the missing read owners

- [ ] Add the existing operator to both lookup subscriptions and detail subscription:

```ts
// Inside loadLookups, keep its existing request/pending/done declarations.
this.accountsService.list(true).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
  next: (rows) => { if (request === this.lookupRequest) this.accounts.set(rows); done(); },
  error: (error: unknown) => {
    if (request === this.lookupRequest) this.lookupError.set(this.errorMessage(error, "Could not load accounts and categories."));
    done();
  },
});
this.categoriesService.list(true).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
  next: (rows) => { if (request === this.lookupRequest) this.categories.set(rows); done(); },
  error: (error: unknown) => {
    if (request === this.lookupRequest) this.lookupError.set(this.errorMessage(error, "Could not load accounts and categories."));
    done();
  },
});

// Inside startEdit, keep the existing state reset/request declarations.
this.transactionsService.get(row.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
  next: (detail) => {
    if (request !== this.detailRequest) return;
    this.detailLoading.set(false);
    this.editingTransaction.set(detail);
    this.formOpen.set(true);
  },
  error: (error: unknown) => {
    if (request !== this.detailRequest) return;
    this.detailLoading.set(false);
    this.saveError.set(this.errorMessage(error, "That transaction is no longer available."));
    if (error instanceof HttpErrorResponse && error.status === 404) this.retry();
  },
});
```

No change to the filtered-list pipeline, `loadLookups`'s pending counter, local dates, transaction money parsing or write requests.

- [ ] Keep the existing superseded-filter test; add this detail-response-order regression:

```ts
it("keeps the newer transaction detail when the old response arrives last", () => {
  flushLookups();
  initialTransactions().flush([]);
  const older = {
    id: 1, accountId: 1, categoryId: 1, amount: -100, description: "Older",
    transactionDate: "2026-09-07",
    createdAt: "2026-09-07T00:00:00Z", updatedAt: "2026-09-07T00:00:00Z",
  };
  const newer = { ...older, id: 2, description: "Newer" };
  fixture.componentInstance.startEdit(older);
  const oldRequest = http.expectOne("/api/transactions/1");
  fixture.componentInstance.startEdit(newer);
  const newRequest = http.expectOne("/api/transactions/2");
  newRequest.flush(newer);
  oldRequest.flush(older);
  expect(fixture.componentInstance.editingTransaction()?.id).toBe(2);
});
```

### 3.3 Verify and commit

- [ ] Run focused transaction tests and frontend suite, then explicitly commit the two files:

```sh
cd frontend
npm test -- --watch=false --include=src/app/features/transactions/transactions.page.spec.ts
npm test -- --watch=false
```

```sh
git add frontend/src/app/features/transactions/transactions.page.ts frontend/src/app/features/transactions/transactions.page.spec.ts
git diff --cached --check
git commit -m "fix: cancel abandoned transaction lookups and details"
```

## Task 4: Prove navigation, operation overlap and shell sign-out contracts

**Files:**
- Modify/test: `frontend/src/app/core/auth/auth-lifecycle.spec.ts`
- Modify/test: `frontend/src/app/core/auth/auth.interceptor.spec.ts`
- Create: `frontend/src/app/layout/app-shell.spec.ts`
- Test: `frontend/src/app/core/auth/auth.guard.spec.ts`

**Interfaces:**
- Consumes: `PendingFormService.begin(owner): () => void`, real auth and guards, `RouterTestingHarness` setup and `identity`/`signIn`/`finishSettingsReads` from Task 1.
- Produces: executable consumer checks for release on route destruction, continued write subscription, old/new overlap, blocked live writes and allowed live 401 redirect.
- No new production interface.

### 4.1 Add actual-router overlap and re-login checks

- [ ] Extend Task 1's harness with the following test. Import `DestroyRef` from Angular.

```ts
it("a late abandoned write cannot release a newer page operation", async () => {
  const harness = await RouterTestingHarness.create("/settings");
  const settings = harness.routeDebugElement!.componentInstance as SettingsPage;
  finishSettingsReads(http);
  settings.profileForm.controls.displayName.setValue("Old name");
  settings.saveProfile();
  const oldWrite = http.expectOne({ method: "PATCH", url: "/api/users/me" });

  // The real guard explicitly permits this auth exit while pending.
  auth.clear();
  await harness.navigateByUrl("/login", DestinationPage);
  expect(oldWrite.cancelled).toBe(false);
  expect(pending.pending()).toBe(false);
  signIn(http, auth);
  await harness.navigateByUrl("/accounts", DestinationPage);
  const newOwner = harness.routeDebugElement!.injector.get(DestroyRef);
  const releaseNew = pending.begin(newOwner);
  oldWrite.flush(null, { status: 422, statusText: "Unprocessable Entity" });
  expect(pending.pending()).toBe(true);

  const router = TestBed.inject(Router);
  expect(await router.navigateByUrl("/categories")).toBe(false);
  expect(router.url).toBe("/accounts");
  releaseNew();
  await harness.navigateByUrl("/categories", DestinationPage);
  expect(router.url).toBe("/categories");
});
```

- [ ] Add this parameterized router test with the old profile write kept outstanding throughout re-login and `/accounts` → `/categories` navigation. It differs from the overlap test: no newer lock exists and navigation must work immediately.

```ts
it.each([200, 422])("allows re-login/navigation before old profile settlement (%s)", async (status) => {
  const harness = await RouterTestingHarness.create("/settings");
  const settings = harness.routeDebugElement!.componentInstance as SettingsPage;
  finishSettingsReads(http);
  settings.profileForm.controls.displayName.setValue("Old name");
  settings.saveProfile();
  const oldWrite = http.expectOne({ method: "PATCH", url: "/api/users/me" });
  auth.clear();
  await harness.navigateByUrl("/login", DestinationPage);
  expect(pending.pending()).toBe(false);
  expect(oldWrite.cancelled).toBe(false);
  signIn(http, auth);
  await harness.navigateByUrl("/accounts", DestinationPage);
  await harness.navigateByUrl("/categories", DestinationPage);
  if (status === 200) {
    oldWrite.flush({ id: 1, username: "user", displayName: "Old name" });
  } else {
    oldWrite.flush(null, { status: 422, statusText: "Unprocessable Entity" });
  }
  expect(TestBed.inject(Router).url).toBe("/categories");
  expect(auth.authState()?.user.id).toBe(identity.user.id);
  expect(pending.pending()).toBe(false);
  http.expectNone((r) => r.method === "GET");
});
```

The late successful profile response may update the same user's display name through existing `AuthService` semantics; do not assert its display name stays unchanged. These checks concern routing/pending state, not profile version arbitration.

### 4.2 Keep legitimate authentication expiry behavior

- [ ] Extend the interceptor's existing protected-401 test to import `Router` and `vi`, then await the redirect:

```ts
await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe("/login"));
```

Make that test async. Keep its existing state-null assertion. Add non-API and `/api/auth/login` 401 tests if not present: subscribe with an error handler, flush 401, assert authenticated state is unchanged by the interceptor. Do not change existing restoration handling just to satisfy these tests.

- [ ] Run guard and interceptor specs. Expected: active protected writes block normal navigation; login remains permitted; a live protected API 401 clears auth and reaches login.

### 4.3 Test the real shell sign-out consumer

- [ ] Create `app-shell.spec.ts` using the actual shell and HTTP auth service; no replacement `PendingFormService` or mocked logout method. Use an independent owner fixture so the shell stays alive when the old operation's owner is destroyed.

```ts
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { Component, DestroyRef, inject } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { Router, provideRouter } from "@angular/router";
import { vi } from "vitest";
import { AuthService } from "../core/auth/auth.service";
import { authInterceptor } from "../core/auth/auth.interceptor";
import { PendingFormService } from "../core/pending-form.service";
import { AppShellComponent } from "./app-shell";

@Component({ standalone: true, template: "" })
class OwnerComponent { readonly destroyRef = inject(DestroyRef); }
@Component({ standalone: true, template: "" })
class LoginDestination {}

describe("shell operation ownership", () => {
  it("an old owner's release cannot unblock sign-out during a newer operation", async () => {
    await TestBed.configureTestingModule({
      imports: [AppShellComponent, OwnerComponent],
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([{ path: "login", component: LoginDestination }]),
      ],
    }).compileComponents();
    const http = TestBed.inject(HttpTestingController);
    const auth = TestBed.inject(AuthService);
    auth.login("user", "correct horse battery staple").subscribe();
    http.expectOne("/api/auth/csrf").flush(null);
    http.expectOne("/api/auth/login").flush({
      user: { id: 1, username: "user", displayName: "User" },
      household: { id: 10, name: "Household" },
    });
    const shell = TestBed.createComponent(AppShellComponent);
    const pending = TestBed.inject(PendingFormService);
    const oldOwner = TestBed.createComponent(OwnerComponent);
    const releaseOld = pending.begin(oldOwner.componentInstance.destroyRef);
    shell.componentInstance.logout();
    http.expectNone("/api/auth/csrf");

    oldOwner.destroy();
    const newOwner = TestBed.createComponent(OwnerComponent);
    const releaseNew = pending.begin(newOwner.componentInstance.destroyRef);
    releaseOld();
    shell.componentInstance.logout();
    http.expectNone("/api/auth/csrf");
    expect(auth.authState()).not.toBeNull();

    releaseNew();
    shell.componentInstance.logout();
    http.expectOne("/api/auth/csrf").flush(null);
    http.expectOne("/api/auth/logout").flush(null);
    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe("/login"));
    expect(auth.authState()).toBeNull();
    http.verify();
  });
});
```

- [ ] Add an immediate-after-destruction variant: acquire one lock, destroy its owner, leave its release callback uncalled until after shell logout succeeds, then call the old callback and assert pending remains false. This proves sign-out works even before a server write's finalizer arrives.

### 4.4 Verify and commit

- [ ] Run the integration/consumer files and full unit suite:

```sh
cd frontend
npm test -- --watch=false --include=src/app/core/auth/auth-lifecycle.spec.ts --include=src/app/core/auth/auth.guard.spec.ts --include=src/app/core/auth/auth.interceptor.spec.ts --include=src/app/layout/app-shell.spec.ts
npm test -- --watch=false
```

- [ ] Commit the new/changed integration tests only:

```sh
git add frontend/src/app/core/auth/auth-lifecycle.spec.ts frontend/src/app/core/auth/auth.interceptor.spec.ts frontend/src/app/layout/app-shell.spec.ts
git diff --cached --check
git commit -m "test: verify re-login navigation and pending operation overlap"
```

## Task 5: Exercise the changed lifecycle with the real disposable browser backend

**Files:**
- Create: `frontend/e2e/auth-lifecycle.spec.ts`
- Read/reuse setup: `frontend/playwright.config.ts`, `frontend/e2e/auth.spec.ts`, `frontend/e2e/settings.spec.ts`
- Do not modify backend seeding, credentials, deployment config or real data.

**Interfaces:**
- Consumes: `BUDGET_E2E_SETTINGS_PASSWORD`, dedicated `e2e-settings-1280` / `e2e-settings-390` identities; `BUDGET_E2E_EXPIRED_SESSION_TOKEN`; real Playwright `route.fetch()` mutation responses and the isolated test `request` fixture for expired-session GET responses.
- Produces: deterministic phone/desktop C4/C6 workflows. Widths: 1280×900 and 390×844.

### 5.1 Build file-local gates and login helpers

- [ ] Use explicit promise gates; they are test-local, not production synchronization code:

```ts
import { expect, test, type Page } from "@playwright/test";

const password = process.env["BUDGET_E2E_SETTINGS_PASSWORD"]!;
const expired = process.env["BUDGET_E2E_EXPIRED_SESSION_TOKEN"]!;
const viewports = [{ width: 1280, height: 900 }, { width: 390, height: 844 }];

function gate() {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => { open = resolve; });
  return { wait, open };
}

async function signIn(page: Page, username: string): Promise<void> {
  // Caller reaches /login without a page reload during the lifecycle race.
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
```

Use the settings identities because existing browser specs restore their seeded passwords. The new tests do not change passwords or mutate financial rows. Profile tests restore the original display name using the real Settings UI before finishing, so repeat runs do not accumulate identity changes.

### 5.2 Add the C4 pending-profile / real-401 workflow

- [ ] For each viewport create one test with these explicit steps:

1. Set viewport; `page.goto('/login')` only for initial setup; sign in as `e2e-settings-${width}`.
2. Before opening Settings, route `**/api/household`. Using the test's isolated `request` fixture, fetch the real response with `request.get(route.request().url(), { headers: { ...route.request().headers(), cookie: \`budget_session=${expired}\` } })`, assert status 401, then wait on a household-response gate. Do not fulfill an invented JSON 401. The isolated fixture prevents cookie-clearing headers from changing the browser cookie jar before the held response is delivered.
3. Route `**/api/users/me` and intercept PATCH only. Fetch the real PATCH immediately, assert status 200, notify a captured gate, then hold delivery on a write-response gate. Non-PATCH requests call `route.continue()`.
4. Click Settings; fill `#settings-display-name` with a temporary valid name; click `Save profile`; wait for the PATCH captured gate. Assert the normal pending status appears. The real write may already have committed; only its delivery is delayed.
5. Open the household-response gate. Await `/login`, which proves the live 401 reached the Angular interceptor and Settings was destroyed. Remove the household route before future Settings visits.
6. Sign in again without reload; click Accounts then Categories and assert both URLs while the PATCH response is still held. Click Sign out and assert login.
7. Sign in once more. Deliver the held PATCH using `route.fulfill({ response })`; wait for the handler-finished gate and a browser round-trip. Assert the page remains dashboard and normal navigation still works; click Sign out and assert login after settlement.
8. Re-login, remove the PATCH delay route and restore the original profile name through Settings. Sign out normally.

Use the test callback `async ({ page, request }) => { ... }` so the isolated `request` fixture is available. Expired-session GETs must not use the browser-bound API request context: processing their cookie-clearing headers early would create a different race. Forward the real response including its headers only at the intended delivery point.

Core real-response holding pattern for the successful profile mutation:

```ts
const writeCaptured = gate();
const releaseWrite = gate();
const writeFinished = gate();
await page.route("**/api/users/me", async (route) => {
  if (route.request().method() !== "PATCH") return route.continue();
  try {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    writeCaptured.open();
    await releaseWrite.wait;
    await route.fulfill({ response });
  } finally {
    writeFinished.open();
  }
});
```

In a `try/finally` around the scenario, always open both response gates, await handler completion where a request was captured, and remove routes. Never let a failed assertion leave routing promises outstanding. Browser timeouts may bound waits; do not add arbitrary sleep delays.

- [ ] Include active-write navigation denial before the household 401: click Accounts, assert URL stays Settings and no second mutation appears. Keep existing server-side success/validation behavior; no unsafe replay.

### 5.3 Add abandoned-read workflows on all three pages

- [ ] Parameterize account list, category list and transaction lookup abandonment for each viewport (six cases total). Transaction filtered-list cancellation already exists; its missing lookup paths are the browser target here. Fetch expired-session responses through the isolated test `request` fixture, not `page.request` or browser-bound `route.fetch`, so cookie-clearing response headers cannot invalidate the current browser session before delivery.

| Protected page | Held GET match | Real request options |
|---|---|---|
| Accounts | `/api/accounts` without `includeArchived=true` | Original headers with expired `budget_session` cookie |
| Categories | `/api/categories` without `includeArchived=true` | Original headers with expired cookie |
| Transactions | `/api/accounts?includeArchived=true` | Original headers with expired cookie |

For Transactions, hold its account lookup; let category lookup and transaction list complete normally. Unit tests cover the second lookup and each detail path.

Steps for every case:
1. Fresh login; register the chosen GET route before navigating to the target page.
2. Use `request.get(route.request().url(), { headers: { ...route.request().headers(), cookie: \`budget_session=${expired}\` } })`; assert its actual response status 401; signal capture and hold delivery. The `request` fixture has its own cookie storage, independent of the browser.
3. Navigate to Dashboard through the app link; sign out; sign in again without document reload.
4. Open the response gate. Let the route attempt delivery; browser cancellation may make delivery fail even though server response exists. Treat only the confirmed abandoned transport as expected, not arbitrary route errors.
5. Prove continued current-session usability by navigating to a protected page whose GET is not held, awaiting its ready state, and signing out successfully. The server's `/api/auth/me` must return 200 before sign-out.

Use a request-specific `requestfailed` listener plus a handler-finished gate, and in the delivery catch rethrow unless that exact request is known to have failed because of client abortion. Do not swallow fetch/assertion errors. Remove routing before final navigation to the same endpoint. Do not `page.goto` after the race starts: a document reload would hide abandoned subscriptions.

A completed handler is not by itself proof Angular processed a response. The request-cancellation assertion is proven directly in unit tests; the browser evidence is successful protected reads/navigation/sign-out after attempted late delivery. Keep that distinction in the evidence record.

- [ ] Add one live current-session expiry scenario at each viewport: deliver a real expired-session response to a still-mounted page, assert it redirects to login, re-login and sign out. This ensures routing tests have not accidentally hidden legitimate 401 handling.

### 5.4 Verify focused browsers and commit

- [ ] Run only the new browser file; expect all scenarios at both widths. Inspect errors/traces for failed lifecycle order rather than retrying until green.

```sh
cd frontend
npx playwright test e2e/auth-lifecycle.spec.ts --workers=1
```

- [ ] Confirm no real database was used; the configured disposable directory marker and global teardown should remain intact. No new seed household or backend route is needed.

- [ ] Commit only the new browser spec after it passes:

```sh
git add frontend/e2e/auth-lifecycle.spec.ts
git diff --cached --check
git commit -m "test: cover authentication lifecycle races in real browsers"
```

## Task 6: Integrated verification, review and evidence closure

**Files:**
- Modify: `docs/APP_REVIEW.md`
- Modify: `state.md`
- Optionally adjust only package-owned source/tests if review finds a regression; rerun affected checks afterward.

**Interfaces:**
- Consumes: regression results and stable-tree verification output from Tasks 1–5.
- Produces: dated C4/C6 evidence, current suite/build/browser outcomes and clearly preserved release boundaries.

### 6.1 Review the stable diff against the spec

- [ ] Review each mutation caller and every missing-read site. Check the following invariants:
  - No `setPending` remains in production/tests.
  - Each write's finalizer captures its own release, never a newer mutable callback.
  - Release is idempotent, owner destruction unregisters or clears ownership, and settlement does not update dead component UI.
  - No mutation has destruction cancellation or automatic replay.
  - Dead write callbacks cannot start new HTTP GETs.
  - All specified reads have page destruction cleanup; transaction list still cancels superseded filters.
  - Live protected 401 behavior and login/restoration exceptions remain unchanged.
  - No C1/C2/C3/C5 or deployment change is mixed into the diff.

- [ ] Obtain a correctness-focused code review before closure. Resolve only verified findings and rerun relevant regressions. Review does not replace test evidence.

### 6.2 Run all integrated checks on the final source tree

- [ ] Run each command fresh, inspect its output and record actual totals/skips:

```sh
cd backend
python -m pytest -q
```

```sh
cd frontend
npm test -- --watch=false
npm run build
npx playwright test
```

Do not substitute prior `303/77/16` totals. Backend checks confirm no integrated regressions even though this package changes only frontend behavior. Keep platform-specific skips explicit; none of these tests proves actual Unraid/network/recovery acceptance.

- [ ] Run final diff checks, confirm no changes to dependencies or real household database files:

```sh
git diff --check
rg -n 'setPending' frontend/src/app
rg -n 'takeUntilDestroyed|finalize|destroyRef.destroyed' frontend/src/app/features/accounts/accounts.page.ts frontend/src/app/features/categories/categories.page.ts frontend/src/app/features/transactions/transactions.page.ts frontend/src/app/features/budgets/budgets.page.ts frontend/src/app/features/settings/settings.page.ts
git status --short
```

### 6.3 Record evidence precisely

- [ ] In `docs/APP_REVIEW.md`, update C4/C6 status only if baseline races reproduced and acceptance checks passed. Each closure records:
  - Actual original failing assertion and reproduction ordering.
  - Named regression files/test cases that prove the correction.
  - Changed browser workflows and actual viewport results.
  - New verification date, commands/totals and residual limits.

Keep C1/C2/C3/C5 open and preserve operational findings O1–O5. Update the authentication-lifecycle next-task checkbox only; do not mark all P1 tasks complete.

- [ ] In `state.md`, replace the next-coding-priority text with completed C4/C6 evidence and remaining draft/backend/focus work. Preserve historical milestone results and all real-host deployment gates. Release status remains a release candidate with deployment gates pending.

- [ ] If reproduction or required browser acceptance fails, document attempts, retain the corresponding finding open and hand back the blocker. Do not call the package complete merely because a cleanup pattern was added.

### 6.4 Commit documentation and hand off

- [ ] Verify documentation links and `git diff --check`, then commit only the two status documents:

```sh
git add docs/APP_REVIEW.md state.md
git diff --cached --check
git commit -m "docs: record authentication lifecycle verification and remaining gates"
```

- [ ] Final handoff reports: package-owned commits/files, actual verification results, C4/C6 closure status, known limits and remaining tasks. Do not deploy, merge or discard the user's pre-existing working-tree changes without separate direction.

## Spec coverage / review checklist

| Approved requirement | Plan coverage |
|---|---|
| Reproduce C4 before correction | Task 1.1 actual-router Settings/401/mutation ordering |
| Reproduce C6 before correction | Task 2.1 abandoned GET → logout/login → actual interceptor 401 |
| Operation count, independent/idempotent release, unregister | Tasks 1.2–1.3 service contract and real owner tests |
| Migrate all pending consumers, including budgets | Task 1.3 atomic caller migration |
| Writes continue after destruction, dead callbacks do nothing | Task 1.4 feature mutation matrix |
| Old finalizer cannot unlock new operation | Task 1.2 service test, Task 4.1 routing, Task 4.3 shell |
| Re-login navigation/sign-out before/after settlement | Tasks 4.1/4.3 and 5.2 |
| Cancel each missing read and preserve list cancellation | Tasks 2.2–2.3 and 3.1–3.2 |
| Keep sequence checks and live 401 redirects | Tasks 2.3/3.2/4.2 and 5.3 |
| Real-backend desktop/mobile changed-path evidence | Task 5 |
| Integrated checks and honest status closure | Task 6 |
| Preserve unrelated changes and all release gates | Preparation, global constraints and Task 6.3–6.4 |

Plan-only artifact: none of the commands, test snippets or proposed application changes above have been executed as part of writing this plan. Implementation must establish its own red/green and final verification evidence.
