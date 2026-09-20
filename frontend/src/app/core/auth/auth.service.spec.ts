import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { provideHttpClient } from "@angular/common/http";
import { TestBed } from "@angular/core/testing";

import { AuthService } from "./auth.service";
import { AuthState } from "../api/models";

describe("AuthService", () => {
  let service: AuthService;
  let http: HttpTestingController;
  const state: AuthState = {
    user: { id: 1, username: "merlin", displayName: "Merlin" },
    household: { id: 1, name: "Household" },
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it("restores authenticated state and shares concurrent requests", () => {
    const first = service.restore();
    const second = service.restore();
    let firstValue: AuthState | null = null;
    let secondValue: AuthState | null = null;
    first.subscribe((value) => (firstValue = value));
    second.subscribe((value) => (secondValue = value));

    const request = http.expectOne("/api/auth/me");
    request.flush(state);

    expect(firstValue).toEqual(state);
    expect(secondValue).toEqual(state);
    expect(service.authState()).toEqual(state);
    expect(service.restoration()).toBe("ready");
  });

  it("bootstraps CSRF before login and logout, then clears state", () => {
    service.login("merlin", "correct horse battery staple").subscribe();
    http.expectOne("/api/auth/csrf").flush(null);
    http.expectOne("/api/auth/login").flush(state);
    expect(service.authState()).toEqual(state);

    service.logout().subscribe();
    http.expectOne("/api/auth/csrf").flush(null);
    http.expectOne("/api/auth/logout").flush(null);
    expect(service.authState()).toBeNull();
  });

  it("updates the current user's display name in place without revoking state", () => {
    service.restore().subscribe();
    http.expectOne("/api/auth/me").flush(state);

    let updated: AuthState["user"] | null = null;
    service.updateDisplayName("  Merlin Renamed  ").subscribe((user) => (updated = user));
    const request = http.expectOne((r) => r.url === "/api/users/me" && r.method === "PATCH");
    expect(request.request.body).toEqual({ displayName: "  Merlin Renamed  " });
    request.flush({ id: 1, username: "merlin", displayName: "Merlin Renamed" });
    expect(updated).toEqual({ id: 1, username: "merlin", displayName: "Merlin Renamed" });
    expect(service.authState()?.user.displayName).toBe("Merlin Renamed");
    expect(service.authState()?.household).toEqual(state.household);
  });

  it("does not overwrite another user's identity from a stale profile response", () => {
    // Sign in as user 1...
    service.restore().subscribe();
    http.expectOne("/api/auth/me").flush(state);
    // ...then a second login replaces identity with user 7.
    const other: AuthState = {
      user: { id: 7, username: "other", displayName: "Other" },
      household: { id: 2, name: "Other household" },
    };
    service.login("other", "correct horse battery staple").subscribe();
    http.expectOne("/api/auth/csrf").flush(null);
    http.expectOne("/api/auth/login").flush(other);
    expect(service.authState()?.user.id).toBe(7);
    // A stale PATCH response for user 1 arrives afterwards.
    service.updateDisplayName("Stale").subscribe();
    const request = http.expectOne((r) => r.url === "/api/users/me" && r.method === "PATCH");
    request.flush({ id: 1, username: "merlin", displayName: "Stale" });
    // Identity stays user 7; the stale response is discarded.
    expect(service.authState()?.user.id).toBe(7);
    expect(service.authState()?.user.displayName).toBe("Other");
  });

  it("clears auth state on successful password change", () => {
    service.restore().subscribe();
    http.expectOne("/api/auth/me").flush(state);
    service.changePassword("current password 1", "new password 12").subscribe();
    const request = http.expectOne((r) => r.url === "/api/auth/change-password" && r.method === "POST");
    expect(request.request.body).toEqual({ currentPassword: "current password 1", newPassword: "new password 12" });
    request.flush(null);
    expect(service.authState()).toBeNull();
    expect(service.restoration()).toBe("ready");
  });

  it("keeps auth state when the password change fails on a wrong current password", () => {
    service.restore().subscribe();
    http.expectOne("/api/auth/me").flush(state);
    service.changePassword("wrong password 123", "new password 12").subscribe({
      error: () => undefined,
    });
    http.expectOne("/api/auth/change-password").flush(
      { error: { code: "VALIDATION_ERROR", message: "The request could not be processed.", fields: { currentPassword: "Current password is incorrect." } } },
      { status: 422, statusText: "Unprocessable Entity" },
    );
    expect(service.authState()).toEqual(state);
  });
});
