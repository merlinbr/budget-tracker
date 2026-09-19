import { Routes } from "@angular/router";

import { authGuard, anonymousGuard, pendingFormGuard } from "./core/auth/auth.guard";
import { AccountsPage } from "./features/accounts/accounts.page";
import { BudgetsPage } from "./features/budgets/budgets.page";
import { CategoriesPage } from "./features/categories/categories.page";
import { DashboardPage } from "./features/dashboard/dashboard.page";
import { LoginPage } from "./features/login/login.page";
import { TransactionsPage } from "./features/transactions/transactions.page";
import { AppShellComponent } from "./layout/app-shell";

export const routes: Routes = [
  { path: "login", component: LoginPage, canActivate: [anonymousGuard] },
  {
    path: "",
    component: AppShellComponent,
    canActivate: [authGuard],
    children: [
      { path: "", pathMatch: "full", redirectTo: "dashboard" },
      { path: "dashboard", component: DashboardPage, canActivate: [authGuard], canDeactivate: [pendingFormGuard] },
      { path: "accounts", component: AccountsPage, canActivate: [authGuard], canDeactivate: [pendingFormGuard] },
      { path: "transactions", component: TransactionsPage, canActivate: [authGuard], canDeactivate: [pendingFormGuard] },
      { path: "categories", component: CategoriesPage, canActivate: [authGuard], canDeactivate: [pendingFormGuard] },
      { path: "budgets", component: BudgetsPage, canActivate: [authGuard], canDeactivate: [pendingFormGuard] },
    ],
  },
  { path: "**", redirectTo: "dashboard" },
];
