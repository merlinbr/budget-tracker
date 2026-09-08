import { Component, inject } from "@angular/core";

import { AuthService } from "../../core/auth/auth.service";

@Component({
  selector: "app-dashboard-page",
  standalone: true,
  template: `
    @if (auth.authState(); as state) {
      <section class="identity-card" aria-labelledby="identity-title">
        <h2 id="identity-title">Welcome, {{ state.user.displayName }}</h2>
        <dl>
          <div><dt>Username</dt><dd>{{ state.user.username }}</dd></div>
          <div><dt>Household</dt><dd>{{ state.household.name }}</dd></div>
        </dl>
      </section>
    }
  `,
  styles: `
    :host { display: block; }
    .identity-card {
      max-width: 52rem;
      margin: 0 auto;
      padding: clamp(1.25rem, 4vw, 2rem);
      border: 1px solid #d7deeb;
      border-radius: 1rem;
      background: #fff;
    }
    h2 { margin-top: 0; }
    dl { margin: 0; }
    dl > div { padding: 0.75rem 0; border-top: 1px solid #e5e9f1; }
    dt { color: #52617a; font-size: 0.9rem; }
    dd { margin: 0.25rem 0 0; font-weight: 700; }
  `,
})
export class DashboardPage {
  readonly auth = inject(AuthService);
}
