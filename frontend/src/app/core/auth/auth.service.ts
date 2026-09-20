import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { Injectable, inject, signal } from "@angular/core";
import {
  Observable,
  catchError,
  finalize,
  of,
  shareReplay,
  switchMap,
  tap,
  throwError,
} from "rxjs";

import { AuthState } from "../api/models";

export type RestorationState = "loading" | "ready" | "error";

@Injectable({ providedIn: "root" })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly _authState = signal<AuthState | null>(null);
  private readonly _restoration = signal<RestorationState>("loading");
  private restoreRequest: Observable<AuthState | null> | null = null;

  readonly authState = this._authState.asReadonly();
  readonly restoration = this._restoration.asReadonly();

  restore(): Observable<AuthState | null> {
    if (this.restoreRequest) {
      return this.restoreRequest;
    }
    if (this._restoration() === "ready") {
      return of(this._authState());
    }

    this._restoration.set("loading");
    const request = this.http.get<AuthState>("/api/auth/me").pipe(
      tap((state) => {
        this._authState.set(state);
        this._restoration.set("ready");
      }),
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 401) {
          this._authState.set(null);
          this._restoration.set("ready");
          return of(null);
        }
        this._restoration.set("error");
        return throwError(() => error);
      }),
      finalize(() => {
        this.restoreRequest = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.restoreRequest = request;
    return request;
  }

  login(username: string, password: string): Observable<AuthState> {
    return this.http.get<void>("/api/auth/csrf").pipe(
      switchMap(() =>
        this.http.post<AuthState>("/api/auth/login", { username, password }),
      ),
      tap((state) => {
        this._authState.set(state);
        this._restoration.set("ready");
      }),
    );
  }

  logout(): Observable<void> {
    return this.http.get<void>("/api/auth/csrf").pipe(
      switchMap(() => this.http.post<void>("/api/auth/logout", {})),
      tap(() => this.clear()),
    );
  }

  updateDisplayName(displayName: string): Observable<AuthState["user"]> {
    return this.http.patch<AuthState["user"]>("/api/users/me", { displayName }).pipe(
      tap((user) =>
        this._authState.update((state) =>
          state?.user.id === user.id ? { ...state, user } : state,
        ),
      ),
    );
  }

  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.http
      .post<void>("/api/auth/change-password", { currentPassword, newPassword })
      .pipe(tap(() => this.clear()));
  }

  clear(): void {
    this._authState.set(null);
    this._restoration.set("ready");
  }
}
