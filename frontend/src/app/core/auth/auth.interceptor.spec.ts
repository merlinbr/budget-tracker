import { HttpClient, provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";

import { AuthService } from "./auth.service";
import { authInterceptor } from "./auth.interceptor";

@Component({ standalone: true, template: "" })
class EmptyPage {}

describe("authInterceptor", () => {
  let httpClient: HttpClient;
  let http: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([{ path: "login", component: EmptyPage }]),
      ],
    });
    httpClient = TestBed.inject(HttpClient);
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => http.verify());

  it("clears authenticated state after a protected API returns 401", () => {
    const state = {
      user: { id: 1, username: "user", displayName: "User" },
      household: { id: 1, name: "Household" },
    };
    auth.login("user", "correct horse battery staple").subscribe();
    http.expectOne("/api/auth/csrf").flush(null);
    http.expectOne("/api/auth/login").flush(state);
    expect(auth.authState()).not.toBeNull();

    httpClient.get("/api/protected").subscribe({ error: () => undefined });
    http.expectOne("/api/protected").flush(null, {
      status: 401,
      statusText: "Unauthorized",
    });

    expect(auth.authState()).toBeNull();
  });
});
