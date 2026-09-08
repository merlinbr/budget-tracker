import { Routes } from "@angular/router";

import { AccountsPage } from "./features/accounts/accounts.page";
import { CategoriesPage } from "./features/categories/categories.page";
import { DashboardPage } from "./features/dashboard/dashboard.page";
import { LoginPage } from "./features/login/login.page";
import { authGuard, anonymousGuard } from "./core/auth/auth.guard";
import { AppShellComponent } from "./layout/app-shell";

export const routes: Routes = [
  { path: "login", component: LoginPage, canActivate: [anonymousGuard] },
  {
    path: "",
    component: AppShellComponent,
    canActivate: [authGuard],
    children: [
      { path: "", pathMatch: "full", redirectTo: "dashboard" },
      { path: "dashboard", component: DashboardPage, canActivate: [authGuard] },
      { path: "accounts", component: AccountsPage, canActivate: [authGuard] },
      { path: "categories", component: CategoriesPage, canActivate: [authGuard] },
    ],
  },
  { path: "**", redirectTo: "dashboard" },
];
