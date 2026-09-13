import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, ValidationErrors, Validators, AbstractControl } from "@angular/forms";
import { RouterLink } from "@angular/router";

import { Account, Category, Transaction, TransactionType, TransactionWrite } from "../../core/api/models";
import { moneyInput, parseMoney, localToday } from "../../shared/utilities/money";
import { codePointLengthValidator } from "../../shared/utilities/validators";

function amountValidator(control: AbstractControl): ValidationErrors | null {
  const cents = parseMoney(String(control.value ?? ""));
  if (cents === null) return { money: true };
  return cents === 0 ? { zero: true } : null;
}

function calendarDateValidator(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value ?? "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return { date: true };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return { date: true };
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day > daysInMonth ? { date: true } : null;
}

@Component({
  selector: "app-transaction-form",
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <form [formGroup]="form" (ngSubmit)="submitForm()" aria-labelledby="transaction-form-title" [attr.aria-busy]="pending">
      <h3 id="transaction-form-title">{{ transaction ? "Edit transaction" : "Add transaction" }}</h3>
      @if (submitError) { <p class="message error" role="alert">{{ submitError }}</p> }
      <div class="field"><label for="transaction-type">Type</label><select id="transaction-type" formControlName="type" aria-describedby="transaction-type-error"><option value="expense">Expense</option><option value="income">Income</option></select><p id="transaction-type-error" class="field-error" aria-live="polite">{{ fieldError("type") }}</p></div>
      <div class="field"><label for="transaction-amount">Amount (EUR)</label><input id="transaction-amount" type="text" inputmode="decimal" formControlName="amount" aria-describedby="transaction-amount-hint transaction-amount-error" [attr.aria-invalid]="fieldError('amount') ? 'true' : null" /><p id="transaction-amount-hint">Use up to 14 whole digits and two decimals, comma or dot.</p><p id="transaction-amount-error" class="field-error" aria-live="polite">{{ fieldError("amount") }}</p></div>
      <div class="field"><label for="transaction-date">Date</label><input id="transaction-date" type="date" formControlName="transactionDate" aria-describedby="transaction-date-error" [attr.aria-invalid]="fieldError('transactionDate') ? 'true' : null" /><p id="transaction-date-error" class="field-error" aria-live="polite">{{ fieldError("transactionDate") }}</p></div>
      <div class="field"><label for="transaction-account">Account</label><select id="transaction-account" formControlName="accountId" aria-describedby="transaction-account-error" [attr.aria-invalid]="fieldError('accountId') ? 'true' : null"><option [ngValue]="null">Select an account</option>@for (account of accountChoices(); track account.id) { <option [ngValue]="account.id">{{ account.name }}{{ account.isArchived ? " (Archived — retained)" : "" }}</option> }</select><p id="transaction-account-error" class="field-error" aria-live="polite">{{ fieldError("accountId") }}</p>@if (!activeAccountChoices().length) { <p class="hint">No active accounts. <a routerLink="/accounts">Add an account</a>.</p> }</div>
      <div class="field"><label for="transaction-category">Category</label><select id="transaction-category" formControlName="categoryId" aria-describedby="transaction-category-error" [attr.aria-invalid]="fieldError('categoryId') ? 'true' : null"><option [ngValue]="null">Select a category</option>@for (category of categoryChoices(); track category.id) { <option [ngValue]="category.id">{{ category.name }}{{ category.isArchived ? " (Archived — retained)" : "" }}</option> }</select><p id="transaction-category-error" class="field-error" aria-live="polite">{{ fieldError("categoryId") }}</p>@if (!activeCategoryChoices().length) { <p class="hint">No matching active categories. <a routerLink="/categories">Add a category</a>.</p> }</div>
      <div class="field"><label for="transaction-description">Description (optional)</label><textarea id="transaction-description" rows="3" formControlName="description" aria-describedby="transaction-description-error" [attr.aria-invalid]="fieldError('description') ? 'true' : null"></textarea><p id="transaction-description-error" class="field-error" aria-live="polite">{{ fieldError("description") }}</p></div>
      <button type="submit" [disabled]="pending">{{ pending ? "Saving…" : (transaction ? "Save changes" : "Save transaction") }}</button><button type="button" (click)="cancel.emit()" [disabled]="pending">Cancel</button>
    </form>
  `,
  styles: `
    :host { display:block; } form { margin-top:1.5rem; padding:1rem; border:1px solid #d7deeb; border-radius:.75rem; background:#fff; } h3 { margin-top:0; } button { min-height:2.75rem; margin:.25rem; padding:.5rem .8rem; border:0; border-radius:.375rem; background:#1b4d8f; color:#fff; cursor:pointer; font:inherit; font-weight:700; } button:disabled { opacity:.65; cursor:wait; } button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, a:focus-visible { outline:3px solid #f0a500; outline-offset:2px; } .field { margin:1rem 0; } label { display:block; font-weight:700; } input, select, textarea { box-sizing:border-box; display:block; width:100%; min-height:2.75rem; margin-top:.35rem; padding:.5rem; font:inherit; } .field-error { min-height:1.3rem; margin:.25rem 0 0; color:#7c1717; } .message { padding:.75rem; border-radius:.375rem; } .error { background:#fff0f0; color:#7c1717; } .hint { margin:.25rem 0 0; color:#52617a; } a { color:#1b4d8f; font-weight:700; }
  `,
})
export class TransactionForm implements OnChanges {
  @Input({ required: true }) accounts: Account[] = [];
  @Input({ required: true }) categories: Category[] = [];
  @Input() transaction: Transaction | null = null;
  @Input() resetKey = 0;
  @Input() pending = false;
  @Input() fieldErrors: Record<string, string> = {};
  @Input() submitError: string | null = null;
  @Output() readonly save = new EventEmitter<TransactionWrite>();
  @Output() readonly cancel = new EventEmitter<void>();

  private readonly formBuilder = inject(FormBuilder);
  readonly form = this.formBuilder.group({
    type: ["expense" as TransactionType, [Validators.required]],
    amount: ["", [Validators.required, amountValidator]],
    transactionDate: [localToday(), [Validators.required, calendarDateValidator]],
    accountId: [null as number | null, [Validators.required]],
    categoryId: [null as number | null, [Validators.required]],
    description: ["", [codePointLengthValidator(undefined, 500)]],
  });
  private submitted = false;

  constructor() {
    this.form.controls.type.valueChanges.subscribe((type) => {
      const selected = this.categories.find((category) => category.id === this.form.controls.categoryId.value);
      if (selected && selected.type !== type) this.form.controls.categoryId.setValue(null);
    });
  }
  ngOnChanges(changes: SimpleChanges): void {
    if (!changes["transaction"] && !changes["resetKey"]) return;
    if (!this.transaction) {
      this.form.reset({ type: "expense", amount: "", transactionDate: localToday(), accountId: null, categoryId: null, description: "" });
      this.submitted = false;
      return;
    }
    if (!changes["transaction"]) return;
    const amountType: TransactionType = this.transaction.amount < 0 ? "expense" : "income";
    this.form.reset({
      type: amountType,
      amount: moneyInput(this.transaction.amount),
      transactionDate: this.transaction.transactionDate,
      accountId: this.transaction.accountId,
      categoryId: this.transaction.categoryId,
      description: this.transaction.description ?? "",
    });
    this.submitted = false;
  }

  activeAccountChoices(): Account[] {
    return this.accounts.filter((account) => !account.isArchived);
  }

  activeCategoryChoices(): Category[] {
    const type = this.form.controls.type.value;
    return this.categories.filter((category) => category.type === type && !category.isArchived);
  }

  accountChoices(): Account[] {
    const retained = this.transaction?.accountId;
    return this.accounts.filter((account) => !account.isArchived || account.id === retained);
  }

  categoryChoices(): Category[] {
    const type = this.form.controls.type.value;
    const retained = this.transaction?.categoryId;
    return this.categories.filter((category) => category.type === type && (!category.isArchived || category.id === retained));
  }
  submitForm(): void {
    this.submitted = true;
    this.form.markAllAsTouched();
    const raw = this.form.getRawValue();
    const cents = parseMoney(raw.amount ?? "");
    if (this.pending || this.form.invalid || cents === null || cents === 0 || raw.accountId === null || raw.categoryId === null) return;
    this.save.emit({
      accountId: raw.accountId,
      categoryId: raw.categoryId,
      amount: raw.type === "expense" ? -cents : cents,
      description: (raw.description ?? "") === "" ? null : raw.description,
      transactionDate: raw.transactionDate ?? "",
    });
  }

  fieldError(field: string): string {
    const server = this.fieldErrors[field];
    if (server) return server;
    const control = this.form.get(field);
    if (!control || (!control.touched && !this.submitted)) return "";
    if (control.hasError("required")) return "This field is required.";
    if (control.hasError("money")) return "Enter a valid amount with up to two decimals.";
    if (control.hasError("zero")) return "Amount must be greater than zero.";
    if (control.hasError("date")) return "Use a valid calendar date.";
    if (control.hasError("maxlength")) return "Use no more than 500 characters.";
    return "";
  }
}
