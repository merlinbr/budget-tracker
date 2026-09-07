import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router, UrlTree } from "@angular/router";
import { firstValueFrom, Observable } from "rxjs";

import { authGuard } from "./auth.guard";
import { AuthService } from "./auth.service";

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
});
