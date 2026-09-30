import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { Component, DestroyRef, inject } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router, UrlTree } from "@angular/router";
import { firstValueFrom, Observable } from "rxjs";

import { authGuard, pendingFormGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { PendingFormService } from "../pending-form.service";

@Component({ standalone: true, template: "" })
class GuardOwner { readonly destroyRef = inject(DestroyRef); }

describe("authGuard", () => {
  it("redirects unauthenticated navigation to login", async () => {
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as never, {} as never),
    );
    const guardResult = firstValueFrom(
      result as Observable<boolean | UrlTree>,
    );

    http.expectOne("/api/auth/me").flush(null, {
      status: 401,
      statusText: "Unauthorized",
    });

    expect((await guardResult).toString()).toBe(
      router.createUrlTree(["/login"]).toString(),
    );
    http.verify();
  });
  it("allows auth redirects to login while a form operation is pending", () => {
    TestBed.configureTestingModule({ imports: [GuardOwner], providers: [PendingFormService, provideRouter([])] });
    const owner = TestBed.createComponent(GuardOwner);
    const pending = TestBed.inject(PendingFormService);
    const release = pending.begin(owner.componentInstance.destroyRef);
    expect(TestBed.runInInjectionContext(() => pendingFormGuard({} as never, {} as never, {} as never, { url: "/accounts" } as never))).toBe(false);
    expect(TestBed.runInInjectionContext(() => pendingFormGuard({} as never, {} as never, {} as never, { url: "/login" } as never))).toBe(true);
    release();
    expect(TestBed.runInInjectionContext(() => pendingFormGuard({} as never, {} as never, {} as never, { url: "/accounts" } as never))).toBe(true);
  });
});
