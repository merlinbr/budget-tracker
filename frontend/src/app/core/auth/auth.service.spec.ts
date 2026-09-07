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
});
