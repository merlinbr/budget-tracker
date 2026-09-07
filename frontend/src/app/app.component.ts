import { Component } from "@angular/core";
import { RouterOutlet } from "@angular/router";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [RouterOutlet],
  template: "<router-outlet />",
})
export class AppComponent {}

@Component({
  selector: "app-shell",
  standalone: true,
  template: `
    <main class="shell" aria-labelledby="page-title">
      <p class="eyebrow">Private household finance</p>
      <h1 id="page-title">Budget Tracker</h1>
      <p>The application foundation is running.</p>
    </main>
  `,
})
export class AppShellComponent {}
