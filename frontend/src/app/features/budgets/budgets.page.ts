import { HttpErrorResponse } from "@angular/common/http";
import { Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, inject, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { Subject, catchError, finalize, forkJoin, map, of, startWith, switchMap } from "rxjs";

import { Budget, DashboardPeriod } from "../../core/api/models";
import { PendingFormService } from "../../core/pending-form.service";
import { localToday, moneyInput, parseMoney } from "../../shared/utilities/money";
import { CategoriesService } from "../categories/categories.service";
import { BudgetUsageComponent } from "./budget-usage";
import { BudgetsService } from "./budgets.service";

type BudgetEditorRow = {
  categoryId: number;
  categoryName: string;
  isArchived: boolean;
  budget: Budget | null;
};
type BudgetsState =
  | { kind: "loading" }
  | { kind: "ready"; rows: BudgetEditorRow[] }
  | { kind: "error"; message: string };

@Component({
  selector: "app-budgets-page",
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, BudgetUsageComponent],
  template: `
    <section class="page" aria-labelledby="budgets-title">
      <h2 id="budgets-title">Budgets</h2>
      <div class="period-controls">
        <button type="button" (click)="moveMonth(-1)" [disabled]="interactionBlocked() || selectedMonth() === '0001-01'">Previous month</button>
        <div class="field">
          <label for="budgets-month">Month</label>
          <input #monthInput id="budgets-month" type="month" required min="0001-01" max="9999-12"
            [value]="selectedMonth()" (change)="selectMonth(monthInput.value)" [disabled]="interactionBlocked()"
            [attr.aria-invalid]="monthError() ? 'true' : null"
            [attr.aria-describedby]="monthError() ? 'budgets-month-error' : null" />
          @if (monthError(); as error) { <p id="budgets-month-error" class="error">{{ error }}</p> }
        </div>
        <button type="button" (click)="moveMonth(1)" [disabled]="interactionBlocked() || selectedMonth() === '9999-12'">Next month</button>
      </div>
      <p>Selected month: {{ selectedMonth() }}</p>
      <button id="copy-budgets" type="button" (click)="copyPrevious()"
        [disabled]="interactionBlocked() || state().kind !== 'ready' || selectedMonth() === '0001-01'">Copy previous month</button>
      @if (announcement(); as message) { <p class="message" role="status" aria-live="polite">{{ message }}</p> }
      @if (writeError(); as error) { <p id="budget-write-error" class="message error" role="alert">{{ error }}</p> }
      @if (copyTarget(); as target) {
        <section id="copy-confirmation" class="confirm" tabindex="-1" aria-labelledby="copy-title">
          <h3 id="copy-title">Replace matching limits?</h3>
          <p>Copy limits from {{ previousMonth() }} to {{ selectedMonth() }}. Matching current-month limits will be replaced. Target-only and archived budgets will remain unchanged.</p>
          <button type="button" (click)="copyPrevious(true)" [disabled]="pending()">{{ pending() ? 'Copying…' : 'Confirm overwrite' }}</button>
          <button type="button" (click)="cancelCopy()" [disabled]="pending()">Cancel</button>
        </section>
      }
      @let view = state();
      @switch (view.kind) {
        @case ('loading') { <p role="status" aria-live="polite">Loading budgets…</p> }
        @case ('error') {
          <p class="message error" role="alert">{{ view.message }} <button type="button" (click)="retry()" [disabled]="pending()">Retry</button></p>
        }
        @case ('ready') {
          @if (view.rows.length === 0) {
            <p>No expense categories yet. <a routerLink="/categories">Manage categories</a></p>
          } @else {
            <ul class="cards" aria-label="Monthly budgets">
              @for (row of view.rows; track row.categoryId) {
                <li>
                  <h3>{{ row.categoryName }}</h3>
                  @if (row.isArchived) { <p>Archived category</p> }
                  @if (row.budget; as budget) { <app-budget-usage [budget]="budget" /> }
                  @else { <p>No budget</p> }
                  <div class="actions">
                    <button [id]="'budget-edit-' + row.categoryId" type="button" (click)="startEdit(row)" [disabled]="interactionBlocked()">{{ row.budget ? 'Edit limit' : 'Set limit' }}</button>
                    @if (row.budget) {
                      <button [id]="'budget-remove-' + row.categoryId" type="button" (click)="beginRemove(row)" [disabled]="interactionBlocked()">Remove budget</button>
                    }
                  </div>
                  @if (editingRow()?.categoryId === row.categoryId) {
                    <form [formGroup]="form" (ngSubmit)="save()" aria-labelledby="budget-form-title"
                      [attr.aria-busy]="pending()" [attr.aria-describedby]="writeError() ? 'budget-write-error' : null">
                      <h4 id="budget-form-title">{{ row.budget ? 'Edit limit for ' : 'Set limit for ' }}{{ row.categoryName }}</h4>
                      <div class="field">
                        <label for="budget-limit">Monthly limit (EUR)</label>
                        <input id="budget-limit" type="text" inputmode="decimal" formControlName="limitAmount"
                          [readOnly]="pending()" (input)="fieldError.set(null)" aria-describedby="budget-limit-error"
                          [attr.aria-invalid]="limitError() ? 'true' : null" />
                        <p id="budget-limit-error" class="field-error" aria-live="polite">{{ limitError() }}</p>
                      </div>
                      <button type="submit" [disabled]="pending()">{{ pending() ? 'Saving…' : 'Save budget' }}</button>
                      <button type="button" (click)="cancelEdit()" [disabled]="pending()">Cancel</button>
                    </form>
                  }
                  @if (removeTarget()?.categoryId === row.categoryId) {
                    <section id="remove-confirmation" class="confirm" tabindex="-1" aria-labelledby="remove-title">
                      <h4 id="remove-title">Remove budget for {{ row.categoryName }}?</h4>
                      <p>Remove the limit for {{ selectedMonth() }}. The category and its transactions remain unchanged.</p>
                      <button type="button" (click)="confirmRemove()" [disabled]="pending()">{{ pending() ? 'Removing…' : 'Confirm removal' }}</button>
                      <button type="button" (click)="cancelRemove()" [disabled]="pending()">Cancel</button>
                    </section>
                  }
                </li>
              }
            </ul>
          }
        }
      }
    </section>
  `,
  styles: `
    :host { display: block; }
    .page { max-width: 52rem; margin: auto; }
    .period-controls, .actions { display: flex; flex-wrap: wrap; align-items: start; gap: .75rem; }
    .field { min-width: 0; }
    label { display: block; font-weight: 700; }
    button, input { box-sizing: border-box; min-height: 2.75rem; padding: .5rem .75rem; font: inherit; }
    input { max-width: 100%; }
    button { border: 0; border-radius: .375rem; background: #1b4d8f; color: #fff; cursor: pointer; font-weight: 700; }
    button:disabled { opacity: .65; cursor: default; }
    button:focus-visible, input:focus-visible, section[tabindex]:focus-visible, a:focus-visible { outline: 3px solid #f0a500; outline-offset: 2px; }
    .cards { display: grid; gap: .75rem; padding: 0; list-style: none; }
    .cards > li { min-width: 0; padding: 1rem; border: 1px solid #d7deeb; border-radius: .75rem; background: #fff; overflow-wrap: anywhere; }
    .cards h3 { margin-top: 0; }
    form, .confirm { margin-top: 1rem; padding: 1rem; border: 1px solid #d7deeb; border-radius: .75rem; background: #fff; }
    form button, .confirm button { margin: .25rem .5rem .25rem 0; }
    .message { padding: .75rem; border-radius: .375rem; }
    .error { background: #fff0f0; color: #7c1717; }
    .field-error { color: #7c1717; }
    a { color: #1b4d8f; }
    @media (max-width: 30rem) { .period-controls { flex-direction: column; align-items: stretch; } .field input { width: 100%; } .actions button { flex: 1; } }
  `,
})
export class BudgetsPage {
  private readonly service = inject(BudgetsService);
  private readonly categories = inject(CategoriesService);
  private readonly pendingForms = inject(PendingFormService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly requests = new Subject<DashboardPeriod>();
  private focusAfterRefresh: string | null = null;
  readonly form = inject(FormBuilder).nonNullable.group({ limitAmount: [""] });
  readonly selectedMonth = signal(localToday().slice(0, 7));
  readonly monthError = signal<string | null>(null);
  readonly state = signal<BudgetsState>({ kind: "loading" });
  readonly editingRow = signal<BudgetEditorRow | null>(null);
  readonly removeTarget = signal<BudgetEditorRow | null>(null);
  readonly copyTarget = signal<DashboardPeriod | null>(null);
  readonly pending = signal(false);
  readonly fieldError = signal<string | null>(null);
  readonly writeError = signal<string | null>(null);
  readonly announcement = signal<string | null>(null);
  readonly interactionBlocked = computed(() => this.pending() || !!this.editingRow() || !!this.removeTarget() || !!this.copyTarget());
  readonly previousMonth = computed(() => {
    const [year, month] = this.selectedMonth().split("-").map(Number);
    return `${String(month === 1 ? year - 1 : year).padStart(4, "0")}-${String(month === 1 ? 12 : month - 1).padStart(2, "0")}`;
  });

  constructor() {
    this.requests.pipe(
      switchMap((period) => forkJoin({ categories: this.categories.list(), budgets: this.service.list(period) }).pipe(
        map(({ categories, budgets }): BudgetsState => {
          const rows = new Map<number, BudgetEditorRow>();
          for (const category of categories) {
            if (category.type === "expense" && !category.isArchived) rows.set(category.id, {
              categoryId: category.id, categoryName: category.name, isArchived: false, budget: null,
            });
          }
          for (const budget of budgets) rows.set(budget.categoryId, {
            categoryId: budget.categoryId, categoryName: budget.categoryName, isArchived: budget.isArchived, budget,
          });
          return { kind: "ready", rows: [...rows.values()].sort((a, b) =>
            (a.categoryName < b.categoryName ? -1 : a.categoryName > b.categoryName ? 1 : 0) || a.categoryId - b.categoryId) };
        }),
        catchError((error: unknown) => of<BudgetsState>({
          kind: "error",
          message: `${this.announcement() ? "The change succeeded, but the refresh failed. " : ""}${this.errorMessage(error, "Could not load budgets and categories.")}`,
        })),
        startWith<BudgetsState>({ kind: "loading" }),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((state) => {
      this.state.set(state);
      if (state.kind === "ready" && this.focusAfterRefresh) {
        this.focus(this.focusAfterRefresh);
        this.focusAfterRefresh = null;
      }
    });
    this.retry();
  }

  selectMonth(value: string): void {
    if (this.interactionBlocked()) return;
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match || Number(match[1]) < 1 || Number(match[2]) < 1 || Number(match[2]) > 12) {
      this.monthError.set("Choose a month between January 0001 and December 9999.");
      return;
    }
    this.monthError.set(null);
    this.announcement.set(null);
    this.writeError.set(null);
    this.focusAfterRefresh = null;
    this.selectedMonth.set(value);
    this.retry();
  }

  moveMonth(delta: -1 | 1): void {
    if (this.interactionBlocked()) return;
    const [year, month] = this.selectedMonth().split("-").map(Number);
    const index = (year - 1) * 12 + month - 1 + delta;
    if (index < 0 || index >= 9999 * 12) return;
    this.selectMonth(`${String(Math.floor(index / 12) + 1).padStart(4, "0")}-${String(index % 12 + 1).padStart(2, "0")}`);
  }

  retry(): void {
    if (this.interactionBlocked()) return;
    this.requests.next(this.period());
  }

  startEdit(row: BudgetEditorRow): void {
    if (this.interactionBlocked() || this.state().kind !== "ready") return;
    this.editingRow.set(row);
    this.fieldError.set(null);
    this.writeError.set(null);
    this.announcement.set(null);
    this.form.reset({ limitAmount: row.budget ? moneyInput(row.budget.limitAmount) : "" });
    this.focus("#budget-limit");
  }

  cancelEdit(): void {
    const row = this.editingRow();
    if (this.pending() || !row) return;
    this.editingRow.set(null);
    this.writeError.set(null);
    this.focus(`#budget-edit-${row.categoryId}`);
  }

  limitError(): string {
    return this.fieldError() ?? (this.form.controls.limitAmount.touched && this.form.controls.limitAmount.hasError("money")
      ? "Enter a non-negative amount with at most two decimal places, within the supported money range." : "");
  }

  save(): void {
    const row = this.editingRow();
    if (!row || this.pending()) return;
    this.fieldError.set(null);
    this.writeError.set(null);
    this.form.markAllAsTouched();
    const limitAmount = parseMoney(this.form.controls.limitAmount.value);
    if (limitAmount === null) {
      this.form.controls.limitAmount.setErrors({ money: true });
      this.focus("#budget-limit");
      return;
    }
    const period = this.period();
    this.beginWrite();
    this.service.upsert(row.categoryId, period, { limitAmount }).pipe(finalize(() => this.endWrite())).subscribe({
      next: () => this.saved("Budget saved.", period, `#budget-edit-${row.categoryId}`),
      error: (error: unknown) => {
        if (error instanceof HttpErrorResponse && typeof error.error?.error?.fields?.limitAmount === "string") {
          this.fieldError.set(error.error.error.fields.limitAmount);
        }
        this.writeError.set(this.errorMessage(error, "Could not save budget."));
        this.focus("#budget-limit");
      },
    });
  }

  beginRemove(row: BudgetEditorRow): void {
    if (this.interactionBlocked() || this.state().kind !== "ready" || !row.budget) return;
    this.writeError.set(null);
    this.announcement.set(null);
    this.removeTarget.set(row);
    this.focus("#remove-confirmation");
  }

  confirmRemove(): void {
    const row = this.removeTarget();
    if (!row || this.pending()) return;
    const period = this.period();
    this.beginWrite();
    this.service.remove(row.categoryId, period).pipe(finalize(() => this.endWrite())).subscribe({
      next: () => this.saved("Budget removed. Transactions are unchanged.", period, `#budget-edit-${row.categoryId}`),
      error: (error: unknown) => this.writeError.set(this.errorMessage(error, "Could not remove budget.")),
    });
  }

  cancelRemove(): void {
    const row = this.removeTarget();
    if (this.pending() || !row) return;
    this.removeTarget.set(null);
    this.writeError.set(null);
    this.focus(`#budget-remove-${row.categoryId}`);
  }

  copyPrevious(overwrite = false): void {
    if (this.pending() || this.editingRow() || this.removeTarget() || this.state().kind !== "ready" || this.selectedMonth() === "0001-01") return;
    if (overwrite ? !this.copyTarget() : !!this.copyTarget()) return;
    const period = this.copyTarget() ?? this.period();
    this.announcement.set(null);
    this.beginWrite();
    this.service.copyPrevious({ ...period, overwrite }).pipe(finalize(() => this.endWrite())).subscribe({
      next: () => this.saved("Previous month's budgets copied.", period, "#copy-budgets"),
      error: (error: unknown) => {
        if (!overwrite && error instanceof HttpErrorResponse && error.status === 409 && typeof error.error?.error?.fields?.overwrite === "string") {
          this.copyTarget.set(period);
          this.focus("#copy-confirmation");
        } else {
          this.writeError.set(this.errorMessage(error, "Could not copy budgets."));
        }
      },
    });
  }

  cancelCopy(): void {
    if (this.pending() || !this.copyTarget()) return;
    this.copyTarget.set(null);
    this.writeError.set(null);
    this.focus("#copy-budgets");
  }

  private period(): DashboardPeriod {
    const [year, month] = this.selectedMonth().split("-").map(Number);
    return { year, month };
  }

  private beginWrite(): void {
    this.writeError.set(null);
    this.pending.set(true);
    this.pendingForms.setPending(true);
  }

  private endWrite(): void {
    this.pending.set(false);
    this.pendingForms.setPending(false);
  }

  private saved(message: string, period: DashboardPeriod, focus: string): void {
    if (this.destroyRef.destroyed) return;
    this.editingRow.set(null);
    this.removeTarget.set(null);
    this.copyTarget.set(null);
    this.announcement.set(message);
    this.focusAfterRefresh = focus;
    this.requests.next(period);
  }

  private focus(selector: string): void {
    if (this.destroyRef.destroyed) return;
    afterNextRender(() => {
      (this.element.nativeElement.querySelector<HTMLElement>(selector)
        ?? this.element.nativeElement.querySelector<HTMLElement>("#budgets-month"))?.focus();
    }, { injector: this.injector });
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.status === 0) return "Could not connect. Check your connection and try again.";
    return error instanceof HttpErrorResponse && typeof error.error?.error?.message === "string" ? error.error.error.message : fallback;
  }
}
