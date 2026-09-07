import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { catchError, map, of } from "rxjs";

import { AuthService } from "./auth.service";

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.restore().pipe(
    map((state) =>
      state ? true : router.createUrlTree(["/login"]),
    ),
    catchError(() => of(router.createUrlTree(["/login"]))),
  );
};

export const anonymousGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.restore().pipe(
    map((state) =>
      state ? router.createUrlTree(["/dashboard"]) : true,
    ),
    catchError(() => of(true)),
  );
};
