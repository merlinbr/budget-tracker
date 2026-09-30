import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { Component, DestroyRef } from "@angular/core";
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
          { path: "settings", component: SettingsPage, canActivate: [authGuard], canDeactivate: [pendingFormGuard] },
          { path: "accounts", component: DestinationPage, canActivate: [authGuard], canDeactivate: [pendingFormGuard] },
          { path: "categories", component: DestinationPage, canActivate: [authGuard], canDeactivate: [pendingFormGuard] },
        ]),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    pending = TestBed.inject(PendingFormService);
    signIn(http, auth);
  });

  afterEach(() => http.verify());

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

  it("releases a profile write when a separate 401 destroys Settings", async () => {
    const harness = await RouterTestingHarness.create("/settings");
    const settings = harness.routeDebugElement!.componentInstance as SettingsPage;
    const household = http.expectOne("/api/household");
    http.expectOne((r) => r.url === "/api/accounts").flush([]);
    http.expectOne((r) => r.url === "/api/categories").flush([]);
    settings.profileForm.controls.displayName.setValue("Pending name");
    settings.saveProfile();
    const write = http.expectOne({ method: "PATCH", url: "/api/users/me" });
    expect(pending.pending()).toBe(true);

    household.flush(null, { status: 401, statusText: "Unauthorized" });
    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe("/login"));
    expect(harness.routeDebugElement!.componentInstance).toBeInstanceOf(DestinationPage);
    expect(write.cancelled).toBe(false);
    write.flush(null, { status: 422, statusText: "Unprocessable Entity" });
    expect(pending.pending()).toBe(false);

    signIn(http, auth);
    await harness.navigateByUrl("/accounts", DestinationPage);
    expect(TestBed.inject(Router).url).toBe("/accounts");
  });
});
