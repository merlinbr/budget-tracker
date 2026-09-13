import { HttpErrorResponse } from "@angular/common/http";
import { Component, DestroyRef, ElementRef, inject, signal, viewChild } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule } from "@angular/forms";
import { Subject, catchError, map, of, startWith, switchMap } from "rxjs";

import { Account, Category, Transaction, TransactionFilters, TransactionType, TransactionWrite } from "../../core/api/models";
import { PendingFormService } from "../../core/pending-form.service";
import { AccountsService } from "../accounts/accounts.service";
import { CategoriesService } from "../categories/categories.service";
import { formatMoney, localToday } from "../../shared/utilities/money";
import { TransactionForm } from "./transaction-form";
import { TransactionsService } from "./transactions.service";

 type ListState =
  | { kind: "loading" }
  | { kind: "ready"; rows: Transaction[] }
  | { kind: "error"; error: unknown };

const sqliteAsciiLower = (value: string): string => value.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));
@Component({
  selector: "app-transactions-page",
  standalone: true,
  imports: [ReactiveFormsModule, TransactionForm],
  template: `
    <section class="page" aria-labelledby="transactions-title">
      <div class="page-heading"><div><p class="eyebrow">Household activity</p><h2 id="transactions-title">Transactions</h2></div><button #addTransactionButton type="button" (click)="startAdd()" [disabled]="savePending() || deletePending() || detailLoading()">Add transaction</button></div>
      @if (lookupError(); as error) { <p class="message error" role="alert">{{ error }} <button type="button" (click)="loadLookups()">Retry</button></p> }
      @if (!formOpen()) { @if (saveError(); as error) { <p class="message error" role="alert">{{ error }}</p> } }
      @if (announcement(); as message) { <p class="message" role="status" aria-live="polite">{{ message }}</p> }
      <form class="filters" [formGroup]="filterForm" (ngSubmit)="applyFilters()" aria-labelledby="filter-title">
        <h3 id="filter-title">Filter transactions</h3>
        <div class="filter-grid">
          <div class="field"><label for="filter-month">Month</label><input id="filter-month" type="month" formControlName="month" /></div>
          <div class="field"><label for="filter-account">Account</label><select id="filter-account" formControlName="accountId"><option [ngValue]="null">All accounts</option>@for (account of accounts(); track account.id) { <option [ngValue]="account.id">{{ account.name }}{{ account.isArchived ? " (Archived)" : "" }}</option> }</select></div>
          <div class="field"><label for="filter-category">Category</label><select id="filter-category" formControlName="categoryId"><option [ngValue]="null">All categories</option>@for (category of categories(); track category.id) { <option [ngValue]="category.id">{{ category.name }}{{ category.isArchived ? " (Archived)" : "" }}</option> }</select></div>
          <div class="field"><label for="filter-type">Type</label><select id="filter-type" formControlName="type"><option value="">All types</option><option value="expense">Expense</option><option value="income">Income</option></select></div>
          <div class="field search-field"><label for="filter-search">Search description</label><input id="filter-search" type="search" formControlName="search" /></div>
        </div>
        <button type="submit" [disabled]="listLoading()">Apply filters</button><button type="button" (click)="clearFilters()" [disabled]="listLoading()">Clear</button>
      </form>
      @if (listLoading()) { <p role="status" aria-live="polite">Loading transactions…</p> }
      @if (listError(); as error) { <p class="message error" role="alert">{{ error }} <button type="button" (click)="retry()">Retry</button></p> }
      @if (listReady() && transactions().length === 0) { <p class="empty">No transactions match these filters.</p> }
      @if (listReady() && transactions().length) {
        <ul class="cards" aria-label="Transaction history">
          @for (transaction of transactions(); track transaction.id) {
            <li class="card">
              <div class="transaction-main"><div class="transaction-heading"><strong>{{ transaction.transactionDate }}</strong><span class="type">{{ transactionTypeLabel(transaction.amount) }}</span></div><p class="amount" [class.income]="transaction.amount > 0">{{ formatMoney(transaction.amount) }}</p><p>{{ accountName(transaction.accountId) }} · {{ categoryName(transaction.categoryId) }}</p>@if (transaction.description) { <p class="description">{{ transaction.description }}</p> }</div>
              <div class="actions"><button type="button" (click)="startEdit(transaction)" [disabled]="savePending() || deletePending() || detailLoading()" [attr.aria-label]="'Edit transaction ' + (transaction.description || transaction.transactionDate)">Edit</button><button type="button" (click)="beginDelete(transaction)" [disabled]="savePending() || deletePending() || detailLoading()" [attr.aria-label]="'Delete transaction ' + (transaction.description || transaction.transactionDate)">Delete</button></div>
            </li>
          }
        </ul>
      }
      @if (deleteTarget(); as target) { <section class="confirm" #deleteConfirmation tabindex="-1" aria-labelledby="delete-title"><h3 id="delete-title">Delete transaction?</h3><p>{{ target.transactionDate }} · {{ formatMoney(target.amount) }}{{ target.description ? " · " + target.description : "" }}</p><p>This cannot be undone.</p><button type="button" (click)="confirmDelete()" [disabled]="deletePending()">{{ deletePending() ? "Deleting…" : "Confirm delete" }}</button><button type="button" (click)="cancelDelete()" [disabled]="deletePending()">Cancel</button></section> }
      @if (formOpen()) { <app-transaction-form [accounts]="accounts()" [categories]="categories()" [transaction]="editingTransaction()" [resetKey]="formResetKey()" [pending]="savePending() || deletePending()" [fieldErrors]="fieldErrors()" [submitError]="saveError()" (save)="save($event)" (cancel)="cancelForm()" /> }
    </section>
  `,
  styles: `
    :host { display:block; } .page { max-width:52rem; margin:auto; } .page-heading { display:flex; justify-content:space-between; align-items:start; gap:1rem; } h2 { margin-top:.5rem; } h3 { margin-top:0; } button { min-height:2.75rem; margin:.25rem; padding:.5rem .8rem; border:0; border-radius:.375rem; background:#1b4d8f; color:#fff; cursor:pointer; font:inherit; font-weight:700; } button:disabled { opacity:.65; cursor:wait; } button:focus-visible, input:focus-visible, select:focus-visible, section[tabindex]:focus-visible, a:focus-visible { outline:3px solid #f0a500; outline-offset:2px; } .filters, .confirm { margin-top:1.5rem; padding:1rem; border:1px solid #d7deeb; border-radius:.75rem; background:#fff; } .filter-grid { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:.75rem; } .search-field { grid-column:span 2; } .field { margin-bottom:.75rem; } label { display:block; font-weight:700; } input, select { box-sizing:border-box; display:block; width:100%; min-height:2.75rem; margin-top:.35rem; padding:.5rem; font:inherit; } .cards { display:grid; gap:.75rem; padding:0; list-style:none; } .card { display:flex; justify-content:space-between; gap:1rem; align-items:center; padding:1rem; border:1px solid #d7deeb; border-radius:.75rem; background:#fff; } .transaction-main { min-width:0; } .transaction-heading { display:flex; flex-wrap:wrap; gap:.5rem; align-items:center; } .type { color:#52617a; font-size:.9rem; } .amount { margin:.4rem 0; font-weight:700; } .income { color:#176b3a; } .description { overflow-wrap:anywhere; } .card p { margin:.35rem 0 0; color:#52617a; } .card .amount { color:#7c1717; } .card .amount.income { color:#176b3a; } .message { padding:.75rem; border-radius:.375rem; } .error { background:#fff0f0; color:#7c1717; } .empty { padding:1rem; border:1px dashed #aab5c8; } a { color:#1b4d8f; font-weight:700; } @media (max-width:30rem) { .page-heading, .card { align-items:stretch; flex-direction:column; } .page-heading button { width:100%; margin:0; } .filter-grid { grid-template-columns:1fr; } .search-field { grid-column:auto; } .filters button { width:calc(50% - .6rem); } .actions { display:flex; } .actions button { flex:1; } }
  `,
})
export class TransactionsPage {
  readonly transactionsService = inject(TransactionsService);
  readonly accountsService = inject(AccountsService);
  readonly categoriesService = inject(CategoriesService);
  readonly pendingForms = inject(PendingFormService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly filterRequests = new Subject<TransactionFilters>();
  private readonly deleteConfirmation = viewChild<ElementRef<HTMLElement>>("deleteConfirmation");
  private readonly addButton = viewChild<ElementRef<HTMLButtonElement>>("addTransactionButton");
  private deleteTrigger: HTMLButtonElement | null = null;
  private detailRequest = 0;
  private lookupRequest = 0;
  private refreshAfterSave = false;
  private refreshFailure = false;
  private currentFilters: TransactionFilters = { year: Number(localToday().slice(0, 4)), month: Number(localToday().slice(5, 7)) };

  readonly filterForm = this.formBuilder.group({
    month: [localToday().slice(0, 7)],
    accountId: [null as number | null],
    categoryId: [null as number | null],
    type: ["" as TransactionType | ""],
    search: [""],
  });
  readonly accounts = signal<Account[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly transactions = signal<Transaction[]>([]);
  readonly listState = signal<ListState>({ kind: "loading" });
  readonly listLoading = signal(true);
  readonly listError = signal<string | null>(null);
  readonly formResetKey = signal(0);
  readonly lookupError = signal<string | null>(null);
  readonly lookupLoading = signal(false);
  readonly formOpen = signal(false);
  readonly editingTransaction = signal<Transaction | null>(null);
  readonly detailLoading = signal(false);
  readonly savePending = signal(false);
  readonly deletePending = signal(false);
  readonly deleteTarget = signal<Transaction | null>(null);
  readonly fieldErrors = signal<Record<string, string>>({});
  readonly saveError = signal<string | null>(null);
  readonly announcement = signal<string | null>(null);

  constructor() {
    this.filterRequests.pipe(
      switchMap((filters) => this.transactionsService.list(filters).pipe(
        map((rows) => ({ kind: "ready" as const, rows })),
        catchError((error: unknown) => of({ kind: "error" as const, error })),
        startWith({ kind: "loading" as const }),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((state) => {
      this.listState.set(state);
      this.listLoading.set(state.kind === "loading");
      if (state.kind === "ready") {
        this.transactions.set(state.rows);
        this.listError.set(null);
        this.refreshAfterSave = false;
        if (this.refreshFailure) {
          this.announcement.set(null);
          this.refreshFailure = false;
        }
      } else if (state.kind === "error") {
        this.listError.set(this.errorMessage(state.error, "Could not load transactions."));
        if (this.refreshAfterSave) {
          this.announcement.set("Transaction saved, but the list could not be refreshed. Retry to see the current history.");
          this.refreshAfterSave = false;
          this.refreshFailure = true;
        }
      }
    });
    this.loadLookups();
    this.filterRequests.next(this.currentFilters);
  }

  formatMoney = formatMoney;
  transactionTypeLabel(amount: number): string { return amount < 0 ? "Expense" : "Income"; }
  accountName(id: number): string { return this.accounts().find((account) => account.id === id)?.name ?? `Account #${id}`; }
  categoryName(id: number): string { return this.categories().find((category) => category.id === id)?.name ?? `Category #${id}`; }

  listReady(): boolean { return this.listState().kind === "ready"; }
  private matchesFilters(transaction: Transaction): boolean {
    const filters = this.currentFilters;
    if (filters.year !== undefined && filters.month !== undefined &&
        (Number(transaction.transactionDate.slice(0, 4)) !== filters.year || Number(transaction.transactionDate.slice(5, 7)) !== filters.month)) return false;
    if (filters.accountId !== undefined && transaction.accountId !== filters.accountId) return false;
    if (filters.categoryId !== undefined && transaction.categoryId !== filters.categoryId) return false;
    if (filters.type === "income" && transaction.amount <= 0) return false;
    if (filters.type === "expense" && transaction.amount >= 0) return false;
    const search = filters.search?.trim();
    return !search || sqliteAsciiLower(transaction.description ?? "").includes(sqliteAsciiLower(search));
  }

  applyFilters(): void {
    const raw = this.filterForm.getRawValue();
    const month = /^(\d{4})-(\d{2})$/.exec(raw.month ?? "");
    this.currentFilters = {
      ...(month ? { year: Number(month[1]), month: Number(month[2]) } : {}),
      ...(raw.accountId === null ? {} : { accountId: raw.accountId }),
      ...(raw.categoryId === null ? {} : { categoryId: raw.categoryId }),
      ...(raw.type === "" || raw.type === null ? {} : { type: raw.type }),
      ...(raw.search === "" || raw.search === null ? {} : { search: raw.search }),
    };
    this.announcement.set(null);
    this.filterRequests.next(this.currentFilters);
  }

  clearFilters(): void {
    this.filterForm.reset({ month: "", accountId: null, categoryId: null, type: "", search: "" });
    this.applyFilters();
  }

  retry(): void { this.filterRequests.next(this.currentFilters); }

  loadLookups(): void {
    const request = ++this.lookupRequest;
    this.lookupLoading.set(true);
    this.lookupError.set(null);
    let pending = 2;
    const done = () => {
      if (request !== this.lookupRequest) return;
      pending -= 1;
      if (pending === 0) this.lookupLoading.set(false);
    };
    this.accountsService.list(true).subscribe({
      next: (rows) => { if (request === this.lookupRequest) this.accounts.set(rows); done(); },
      error: (error: unknown) => { if (request === this.lookupRequest) this.lookupError.set(this.errorMessage(error, "Could not load accounts and categories.")); done(); },
    });
    this.categoriesService.list(true).subscribe({
      next: (rows) => { if (request === this.lookupRequest) this.categories.set(rows); done(); },
      error: (error: unknown) => { if (request === this.lookupRequest) this.lookupError.set(this.errorMessage(error, "Could not load accounts and categories.")); done(); },
    });
  }
  startAdd(): void {
    ++this.detailRequest;
    this.detailLoading.set(false);
    this.editingTransaction.set(null);
    this.formResetKey.update((value) => value + 1);
    this.formOpen.set(true);
    this.saveError.set(null);
    this.fieldErrors.set({});
    this.announcement.set(null);
  }
  startEdit(row: Transaction): void {
    this.saveError.set(null);
    this.fieldErrors.set({});
    this.announcement.set(null);
    const request = ++this.detailRequest;
    this.detailLoading.set(true);
    this.transactionsService.get(row.id).subscribe({
      next: (detail) => {
        if (request !== this.detailRequest) return;
        this.detailLoading.set(false);
        this.editingTransaction.set(detail);
        this.formOpen.set(true);
      },
      error: (error: unknown) => {
        if (request !== this.detailRequest) return;
        this.detailLoading.set(false);
        this.saveError.set(this.errorMessage(error, "That transaction is no longer available."));
        if (error instanceof HttpErrorResponse && error.status === 404) this.retry();
      },
    });
  }

  cancelForm(): void {
    if (this.savePending() || this.deletePending()) return;
    ++this.detailRequest;
    this.detailLoading.set(false);
    this.formOpen.set(false);
    this.editingTransaction.set(null);
    this.saveError.set(null);
    this.fieldErrors.set({});
  }

  save(body: TransactionWrite): void {
    if (this.savePending() || this.deletePending()) return;
    this.saveError.set(null);
    this.fieldErrors.set({});
    const original = this.editingTransaction();
    this.savePending.set(true);
    this.pendingForms.setPending(true);
    const request = original ? this.transactionsService.update(original.id, body) : this.transactionsService.create(body);
    request.subscribe({
      next: (saved) => {
        this.pendingForms.setPending(false);
        this.savePending.set(false);
        this.formOpen.set(false);
        this.editingTransaction.set(null);
        const action = original ? "updated" : "saved";
        this.announcement.set(`Transaction ${action}.${this.matchesFilters(saved) ? "" : " It may be hidden by the current filters."}`);
        this.refreshAfterSave = true;
        this.loadLookups();
        this.filterRequests.next(this.currentFilters);
      },
      error: (error: unknown) => {
        this.pendingForms.setPending(false);
        this.savePending.set(false);
        this.applyServerError(error, "Could not save transaction.");
      },
    });
  }

  beginDelete(transaction: Transaction): void {
    this.saveError.set(null);
    this.deleteTrigger = (document.activeElement as HTMLButtonElement) ?? null;
    this.deleteTarget.set(transaction);
    queueMicrotask(() => this.deleteConfirmation()?.nativeElement.focus());
  }

  cancelDelete(): void {
    this.deleteTarget.set(null);
    this.saveError.set(null);
    this.focusAfterCancel();
  }

  confirmDelete(): void {
    const target = this.deleteTarget();
    if (!target || this.deletePending() || this.savePending()) return;
    this.deletePending.set(true);
    this.pendingForms.setPending(true);
    this.transactionsService.remove(target.id).subscribe({
      next: () => {
        this.pendingForms.setPending(false);
        this.deletePending.set(false);
        this.deleteTarget.set(null);
        this.saveError.set(null);
        this.announcement.set("Transaction deleted.");
        this.loadLookups();
        this.filterRequests.next(this.currentFilters);
        this.focusAfterDelete();
      },
      error: (error: unknown) => {
        this.pendingForms.setPending(false);
        this.deletePending.set(false);
        this.saveError.set(error instanceof HttpErrorResponse && error.status === 404 ? "That transaction was already deleted. Refreshing the list." : this.errorMessage(error, "Could not delete transaction."));
        if (error instanceof HttpErrorResponse && error.status === 404) {
          this.deleteTarget.set(null);
          this.retry();
          this.focusAfterDelete();
        }
      },
    });
  }

  private focusAfterDelete(): void {
    queueMicrotask(() => this.addButton()?.nativeElement.focus());
  }

  private focusAfterCancel(): void {
    queueMicrotask(() => {
      if (this.deleteTrigger && document.body.contains(this.deleteTrigger)) this.deleteTrigger.focus();
      else this.addButton()?.nativeElement.focus();
    });
  }

  private applyServerError(error: unknown, fallback: string): void {
    if (error instanceof HttpErrorResponse && error.error?.error?.fields) this.fieldErrors.set(error.error.error.fields as Record<string, string>);
    this.saveError.set(error instanceof HttpErrorResponse && error.status === 403 ? "The request was not verified. Check your session and try again." : this.errorMessage(error, fallback));
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.status === 0) return "Could not connect. Check your connection and try again.";
    if (error instanceof HttpErrorResponse && typeof error.error?.error?.message === "string") return error.error.error.message;
    return fallback;
  }
}
