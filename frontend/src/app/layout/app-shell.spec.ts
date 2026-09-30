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
  let http: HttpTestingController;
  let auth: AuthService;
  let pending: PendingFormService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppShellComponent, OwnerComponent],
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([{ path: "login", component: LoginDestination }]),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    pending = TestBed.inject(PendingFormService);
    auth.login("user", "correct horse battery staple").subscribe();
    http.expectOne("/api/auth/csrf").flush(null);
    http.expectOne("/api/auth/login").flush({
      user: { id: 1, username: "user", displayName: "User" },
      household: { id: 10, name: "Household" },
    });
  });

  afterEach(() => http.verify());

  it("an old owner's release cannot unblock sign-out during a newer operation", async () => {
    const shell = TestBed.createComponent(AppShellComponent);
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
  });

  it("allows sign-out immediately after owner destruction before its late release", async () => {
    const shell = TestBed.createComponent(AppShellComponent);
    const owner = TestBed.createComponent(OwnerComponent);
    const release = pending.begin(owner.componentInstance.destroyRef);
    expect(pending.pending()).toBe(true);

    owner.destroy();
    expect(pending.pending()).toBe(false);
    shell.componentInstance.logout();
    http.expectOne("/api/auth/csrf").flush(null);
    http.expectOne("/api/auth/logout").flush(null);
    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe("/login"));
    expect(auth.authState()).toBeNull();

    release();
    expect(pending.pending()).toBe(false);
  });
});
