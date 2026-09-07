import { Routes } from "@angular/router";

import { authGuard, anonymousGuard } from "./core/auth/auth.guard";
import { LoginPage } from "./features/login/login.page";
import { AppShellComponent } from "./layout/app-shell";

export const routes: Routes = [
  { path: "", pathMatch: "full", redirectTo: "dashboard" },
  { path: "login", component: LoginPage, canActivate: [anonymousGuard] },
  { path: "dashboard", component: AppShellComponent, canActivate: [authGuard] },
  { path: "**", redirectTo: "dashboard" },
];
