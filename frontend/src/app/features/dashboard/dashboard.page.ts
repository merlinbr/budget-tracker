import { HttpErrorResponse } from "@angular/common/http";
import { Component, DestroyRef, inject, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { Subject, catchError, map, of, startWith, switchMap } from "rxjs";

import { DashboardPeriod, DashboardResponse } from "../../core/api/models";
import { formatMoney, localToday } from "../../shared/utilities/money";
import { DashboardService } from "./dashboard.service";

type DashboardState =
  | { kind: "loading" }
  | { kind: "ready"; data: DashboardResponse }
  | { kind: "error"; message: string };

@Component({
  selector: "app-dashboard-page",
  standalone: true,
  template: `
    <section class="page" aria-labelledby="dashboard-title">
      <h2 id="dashboard-title">Dashboard</h2>
      <div class="period-controls">
        <button type="button" (click)="moveMonth(-1)" [disabled]="selectedMonth() === '0001-01'">Previous month</button>
        <div class="field">
          <label for="dashboard-month">Month</label>
          <input #monthInput id="dashboard-month" type="month" required min="0001-01" max="9999-12"
            [value]="selectedMonth()" (change)="selectMonth(monthInput.value)"
            [attr.aria-invalid]="monthError() ? 'true' : null"
            [attr.aria-describedby]="monthError() ? 'dashboard-month-error' : null" />
          @if (monthError(); as error) { <p id="dashboard-month-error" class="error">{{ error }}</p> }
        </div>
        <button type="button" (click)="moveMonth(1)" [disabled]="selectedMonth() === '9999-12'">Next month</button>
      </div>
      <p>Selected month: {{ selectedMonth() }}</p>
      @let view = state();
      @switch (view.kind) {
        @case ('loading') { <p role="status" aria-live="polite">Loading dashboard…</p> }
        @case ('error') {
          <p class="error" role="alert">{{ view.message }} <button type="button" (click)="retry()">Retry</button></p>
        }
        @case ('ready') {
          <dl class="summary" aria-label="Financial summary">
            <div><dt>Current account balance</dt><dd>{{ formatMoney(view.data.summary.balance) }}</dd></div>
            <div><dt>Income this month</dt><dd>{{ formatMoney(view.data.summary.income) }}</dd></div>
            <div><dt>Expenses this month</dt><dd>{{ formatMoney(view.data.summary.expenses) }}</dd></div>
            <div><dt>Net this month</dt><dd>{{ formatMoney(view.data.summary.net) }}</dd></div>
          </dl>
          <p>Current balance includes all dates for non-archived accounts. Monthly activity includes archived accounts and categories.</p>
          <section aria-labelledby="spending-title">
            <h3 id="spending-title">Spending by category</h3>
            @if (view.data.spendingByCategory.length === 0) { <p>No spending this month.</p> }
            @else {
              <ul class="cards" aria-label="Spending by category">
                @for (row of view.data.spendingByCategory; track row.categoryId) {
                  <li><span>{{ row.categoryName }}</span><strong>{{ formatMoney(row.spent) }}</strong></li>
                }
              </ul>
            }
          </section>
          <section aria-labelledby="recent-title">
            <h3 id="recent-title">Recent transactions</h3>
            @if (view.data.recentTransactions.length === 0) { <p>No transactions this month.</p> }
            @else {
              <ul class="cards" aria-label="Recent transactions">
                @for (row of view.data.recentTransactions; track row.id) {
                  <li>
                    <time [attr.datetime]="row.transactionDate">{{ row.transactionDate }}</time>
                    <p>{{ row.description || 'No description' }}</p>
                    <p>{{ row.categoryName }} · {{ row.accountName }}</p>
                    <p>{{ row.amount < 0 ? 'Expense' : 'Income' }}: <strong>{{ formatMoney(row.amount) }}</strong></p>
                  </li>
                }
              </ul>
            }
          </section>
        }
      }
    </section>
  `,
  styles: `
    :host { display: block; }
    .page { max-width: 52rem; margin: auto; }
    .period-controls { display: flex; flex-wrap: wrap; align-items: start; gap: .75rem; }
    .field { min-width: 0; }
    label { display: block; font-weight: 700; }
    button, input { box-sizing: border-box; min-height: 2.75rem; padding: .5rem .75rem; font: inherit; }
    input { max-width: 100%; }
    button { border: 0; border-radius: .375rem; background: #1b4d8f; color: #fff; cursor: pointer; font-weight: 700; }
    button:disabled { opacity: .65; cursor: default; }
    button:focus-visible, input:focus-visible { outline: 3px solid #f0a500; outline-offset: 2px; }
    .summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; }
    .summary > div, .cards > li { min-width: 0; padding: 1rem; border: 1px solid #d7deeb; border-radius: .75rem; background: #fff; overflow-wrap: anywhere; }
    dt { color: #52617a; }
    dd { margin: .5rem 0 0; font-size: 1.25rem; font-weight: 700; }
    .cards { display: grid; gap: .75rem; padding: 0; list-style: none; }
    .cards li > span { margin-right: 1rem; }
    .error { padding: .75rem; background: #fff0f0; color: #7c1717; border-radius: .375rem; }
    @media (max-width: 30rem) { .summary { grid-template-columns: 1fr; } .period-controls { flex-direction: column; align-items: stretch; } }
  `,
})
export class DashboardPage {
  private readonly service = inject(DashboardService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly requests = new Subject<DashboardPeriod>();
  readonly selectedMonth = signal(localToday().slice(0, 7));
  readonly monthError = signal<string | null>(null);
  readonly state = signal<DashboardState>({ kind: "loading" });
  readonly formatMoney = formatMoney;

  constructor() {
    this.requests
      .pipe(
        switchMap(({ year, month }) =>
          this.service.get(year, month).pipe(
            map((data): DashboardState => ({ kind: "ready", data })),
            catchError((error: unknown) =>
              of<DashboardState>({
                kind: "error",
                message:
                  error instanceof HttpErrorResponse && error.status === 0
                    ? "Could not connect. Check your connection and try again."
                    : error instanceof HttpErrorResponse && typeof error.error?.error?.message === "string"
                      ? error.error.error.message
                      : "Could not load dashboard.",
              }),
            ),
            startWith<DashboardState>({ kind: "loading" }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((state) => this.state.set(state));
    this.retry();
  }

  selectMonth(value: string): void {
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match || Number(match[1]) < 1 || Number(match[2]) < 1 || Number(match[2]) > 12) {
      this.monthError.set("Choose a month between January 0001 and December 9999.");
      return;
    }
    this.monthError.set(null);
    this.selectedMonth.set(value);
    this.retry();
  }

  moveMonth(delta: -1 | 1): void {
    const [year, month] = this.selectedMonth().split("-").map(Number);
    const index = (year - 1) * 12 + month - 1 + delta;
    if (index < 0 || index >= 9999 * 12) return;
    this.selectMonth(
      `${String(Math.floor(index / 12) + 1).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`,
    );
  }

  retry(): void {
    const [year, month] = this.selectedMonth().split("-").map(Number);
    this.requests.next({ year, month });
  }
}