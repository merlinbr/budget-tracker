import { HttpErrorResponse } from "@angular/common/http";
import { Component, inject, signal } from "@angular/core";
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";

import { AuthService } from "../core/auth/auth.service";
import { PendingFormService } from "../core/pending-form.service";
@Component({
  selector: "app-shell",
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    @if (auth.authState()) {
      <main class="dashboard" aria-labelledby="page-title">
        <header class="dashboard-header">
          <div>
            <p class="eyebrow">Private household finance</p>
            <h1 id="page-title">Budget Tracker</h1>
          </div>
          <button type="button" (click)="logout()" [disabled]="isLoggingOut()">
            {{ isLoggingOut() ? "Signing out…" : "Sign out" }}
          </button>
        </header>
        <nav aria-label="Primary navigation">
          <a routerLink="/dashboard" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" ariaCurrentWhenActive="page">Dashboard</a>
          <a routerLink="/accounts" routerLinkActive="active" ariaCurrentWhenActive="page">Accounts</a>
          <a routerLink="/categories" routerLinkActive="active" ariaCurrentWhenActive="page">Categories</a>
        </nav>
        @if (logoutError(); as errorMessage) {
          <p class="message error" role="alert">{{ errorMessage }}</p>
        }
        <router-outlet />
      </main>
    }
  `,
  styles: `
    :host { display: block; }
    .dashboard {
      box-sizing: border-box;
      min-height: 100vh;
      padding: clamp(1.5rem, 5vw, 4rem);
    }
    .dashboard-header {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 1rem;
      max-width: 52rem;
      margin: 0 auto 1rem;
    }
    .eyebrow {
      margin: 0;
      color: #52617a;
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    h1 { margin: 0.5rem 0 0; }
    button {
      min-height: 2.75rem;
      padding: 0.5rem 1rem;
      border: 0;
      border-radius: 0.375rem;
      background: #1b4d8f;
      color: #fff;
      cursor: pointer;
      font: inherit;
      font-weight: 700;
    }
    button:disabled { cursor: wait; opacity: 0.65; }
    button:focus-visible, a:focus-visible { outline: 3px solid #f0a500; outline-offset: 2px; }
    nav {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      max-width: 52rem;
      margin: 0 auto 1.5rem;
    }
    nav a {
      padding: 0.5rem 0.75rem;
      border-radius: 0.375rem;
      color: #1b4d8f;
      font-weight: 700;
    }
    nav a.active { background: #e6eefb; }
    .message { max-width: 52rem; margin: 1rem auto; padding: 0.75rem; border-radius: 0.375rem; }
    .error { background: #fff0f0; color: #7c1717; }
    @media (max-width: 30rem) {
      .dashboard-header { align-items: stretch; flex-direction: column; }
      .dashboard-header button { width: 100%; }
      nav a { flex: 1 1 30%; text-align: center; }
    }
  `,
})
export class AppShellComponent {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly isLoggingOut = signal(false);
  readonly logoutError = signal<string | null>(null);
  readonly pendingForms = inject(PendingFormService);

  guardNavigation(event: Event): void {
    if (this.pendingForms.pending()) {
      event.preventDefault();
      this.logoutError.set("Finish saving the current form before navigating away.");
    }
  }

  logout(): void {
    if (this.pendingForms.pending()) {
      this.logoutError.set("Finish saving the current form before signing out.");
      return;
    }
    if (this.isLoggingOut()) {
      return;
    }
    this.logoutError.set(null);
    this.isLoggingOut.set(true);
    this.auth.logout().subscribe({
      next: () => {
        this.isLoggingOut.set(false);
        void this.router.navigateByUrl("/login");
      },
      error: (error: unknown) => {
        this.isLoggingOut.set(false);
        this.logoutError.set(
          error instanceof HttpErrorResponse && error.status === 0
            ? "Could not sign out. Check your connection and try again."
            : "Could not sign out. The server did not confirm logout.",
        );
      },
    });
  }
}
