import {
  HttpErrorResponse,
  HttpInterceptorFn,
} from "@angular/common/http";
import { inject } from "@angular/core";
import { Router } from "@angular/router";
import { catchError, throwError } from "rxjs";

import { AuthService } from "./auth.service";

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return next(request).pipe(
    catchError((error: unknown) => {
      const isApiRequest = request.url.startsWith("/api/");
      const isRestore = request.url === "/api/auth/me";
      const isLogin = request.url === "/api/auth/login";
      if (
        isApiRequest &&
        !isRestore &&
        !isLogin &&
        error instanceof HttpErrorResponse &&
        error.status === 401
      ) {
        auth.clear();
        if (router.url !== "/login") {
          void router.navigateByUrl("/login");
        }
      }
      return throwError(() => error);
    }),
  );
};
