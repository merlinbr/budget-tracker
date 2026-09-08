import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router, UrlTree } from "@angular/router";
import { firstValueFrom, Observable } from "rxjs";

import { authGuard, pendingFormGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { PendingFormService } from "../pending-form.service";

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
    TestBed.configureTestingModule({ providers: [PendingFormService, provideRouter([])] });
    const pending = TestBed.inject(PendingFormService);
    pending.setPending(true);
    expect(TestBed.runInInjectionContext(() => pendingFormGuard({} as never, {} as never, {} as never, { url: "/accounts" } as never))).toBe(false);
    expect(TestBed.runInInjectionContext(() => pendingFormGuard({} as never, {} as never, {} as never, { url: "/login" } as never))).toBe(true);
    pending.setPending(false);
    expect(TestBed.runInInjectionContext(() => pendingFormGuard({} as never, {} as never, {} as never, { url: "/accounts" } as never))).toBe(true);
  });
});
