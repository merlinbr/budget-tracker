import { Routes } from "@angular/router";

import { AppShellComponent } from "./app.component";

export const routes: Routes = [
  { path: "", component: AppShellComponent },
  { path: "**", redirectTo: "" },
];
