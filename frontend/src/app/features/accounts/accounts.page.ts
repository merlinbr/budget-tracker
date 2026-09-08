import { HttpErrorResponse } from "@angular/common/http";
import { PendingFormService } from "../../core/pending-form.service";
import { Component, ElementRef, inject, signal, viewChild } from "@angular/core";
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from "@angular/forms";

import { Account, AccountType } from "../../core/api/models";
import { AccountsService } from "./accounts.service";
import { formatMoney, parseSignedMoney, signedMoneyInput } from "../../shared/utilities/money";
import { codePointLengthValidator } from "../../shared/utilities/validators";

const accountTypes: AccountType[] = ["checking", "savings", "credit_card", "cash", "other"];

function signedMoneyValidator(control: AbstractControl): ValidationErrors | null {
  return parseSignedMoney(String(control.value ?? "")) === null ? { money: true } : null;
}

@Component({
  selector: "app-accounts-page",
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <section class="page" aria-labelledby="accounts-title">
      <div class="page-heading">
        <div><p class="eyebrow">Money sources</p><h2 id="accounts-title">Accounts</h2></div>
        <button #addAccountButton type="button" (click)="startAdd()" [disabled]="isSubmitting() || archivePending()">Add account</button>
      </div>
      <label class="toggle"><input type="checkbox" [checked]="includeArchived()" (change)="toggleArchived($event)" [disabled]="isLoading() || isSubmitting()" /> Show archived accounts</label>
      @if (isLoading()) { <p role="status" aria-live="polite">Loading accounts…</p> }
      @if (listError(); as error) { <p class="message error" role="alert">{{ error }} <button type="button" (click)="loadList()">Retry</button></p> }
      @if (saveError(); as error) { <p class="message error" role="alert">{{ error }}</p> }
      @if (announcement(); as message) { <p class="message" role="status" aria-live="polite">{{ message }}</p> }
      @if (!isLoading() && !listError() && accounts().length === 0) { <p class="empty">{{ includeArchived() ? "No accounts, including archived accounts." : "No accounts yet." }} <button type="button" (click)="startAdd()">Add an account</button></p> }
      @if (accounts().length) {
        <ul class="cards">
          @for (account of accounts(); track account.id) {
            <li class="card" [class.archived]="account.isArchived">
              <div><h3>{{ account.name }}</h3><p>{{ accountTypeLabel(account.type) }} · {{ formatMoney(account.balance) }}</p></div>
              @if (account.isArchived) { <p class="status">Archived (read-only)</p> }
              @else { <div class="actions"><button type="button" (click)="startEdit(account)" [disabled]="isSubmitting() || archivePending()" [attr.aria-label]="'Edit account ' + account.name">Edit</button><button type="button" (click)="beginArchive(account)" [disabled]="isSubmitting() || archivePending()" [attr.aria-label]="'Archive account ' + account.name">Archive</button></div> }
            </li>
          }
        </ul>
      }
      @if (archiveTarget(); as target) {
        <section class="confirm" #archiveConfirmation tabindex="-1" aria-labelledby="archive-title">
          <h3 id="archive-title">Archive {{ target.name }}?</h3><p>This account will be hidden from the active list.</p>
          <button type="button" (click)="confirmArchive()" [disabled]="archivePending()">{{ archivePending() ? "Archiving…" : "Confirm archive" }}</button>
          <button type="button" (click)="cancelArchive()" [disabled]="archivePending()">Cancel</button>
        </section>
      }
      @if (formOpen()) {
        <form [formGroup]="form" (ngSubmit)="save()" aria-labelledby="account-form-title" [attr.aria-busy]="isSubmitting()">
          <h3 id="account-form-title">{{ editingAccount() ? "Edit account" : "Add account" }}</h3>
          <div class="field"><label for="account-name">Name</label><input id="account-name" type="text" formControlName="name" aria-describedby="account-name-error" [attr.aria-invalid]="fieldError('name') ? 'true' : null" /><p id="account-name-error" class="field-error" aria-live="polite">{{ fieldError("name") }}</p></div>
          <div class="field"><label for="account-type">Type</label><select id="account-type" formControlName="type" aria-describedby="account-type-error"><option value="checking">Checking</option><option value="savings">Savings</option><option value="credit_card">Credit card</option><option value="cash">Cash</option><option value="other">Other</option></select><p id="account-type-error" class="field-error" aria-live="polite">{{ fieldError("type") }}</p></div>
          <div class="field"><label for="initial-balance">Initial balance (EUR)</label><input id="initial-balance" type="text" inputmode="decimal" formControlName="initialBalance" aria-describedby="initial-balance-hint initial-balance-error" [attr.aria-invalid]="form.controls.initialBalance.invalid && form.controls.initialBalance.touched" /><p id="initial-balance-hint">Use up to 14 whole digits and two decimals, comma or dot, no grouping. A leading minus means money owed.</p><p id="initial-balance-error" class="field-error" aria-live="polite">{{ initialBalanceError() }}</p></div>
          @if (balanceChanged()) { <div class="warning"><p>Changing the initial balance changes the account's starting money.</p><label><input type="checkbox" formControlName="acknowledgeBalanceChange" /> I understand this balance change</label><p class="field-error" aria-live="polite">{{ fieldError("acknowledgeBalanceChange") }}</p></div> }
          <button type="submit" [disabled]="isSubmitting()">{{ isSubmitting() ? "Saving…" : "Save account" }}</button><button type="button" (click)="cancelForm()" [disabled]="isSubmitting()">Cancel</button>
        </form>
      }
    </section>
  `,
  styles: `
    :host { display:block; } .page { max-width:52rem; margin:auto; } .page-heading { display:flex; justify-content:space-between; align-items:start; gap:1rem; } h2 { margin-top:.5rem; } h3 { margin:0; } button { min-height:2.75rem; margin:.25rem; padding:.5rem .8rem; border:0; border-radius:.375rem; background:#1b4d8f; color:#fff; cursor:pointer; font:inherit; font-weight:700; } button:disabled { opacity:.65; cursor:wait; } button:focus-visible, input:focus-visible, select:focus-visible, section[tabindex]:focus-visible { outline:3px solid #f0a500; outline-offset:2px; } .toggle { display:block; margin:1rem 0; } .cards { display:grid; gap:.75rem; padding:0; list-style:none; } .card { display:flex; justify-content:space-between; gap:1rem; align-items:center; padding:1rem; border:1px solid #d7deeb; border-radius:.75rem; background:#fff; } .card p { margin:.35rem 0 0; color:#52617a; } .archived { opacity:.8; } .status { font-weight:700; } form, .confirm { margin-top:1.5rem; padding:1rem; border:1px solid #d7deeb; border-radius:.75rem; background:#fff; } .field { margin:1rem 0; } label { font-weight:700; } input, select { box-sizing:border-box; display:block; width:100%; min-height:2.75rem; margin-top:.35rem; padding:.5rem; font:inherit; } input[type=checkbox] { display:inline; width:auto; min-height:auto; margin-right:.4rem; } .field-error { min-height:1.3rem; margin:.25rem 0 0; color:#7c1717; } .message { padding:.75rem; border-radius:.375rem; } .error { background:#fff0f0; color:#7c1717; } .empty { padding:1rem; border:1px dashed #aab5c8; } .warning { padding:.75rem; border-left:4px solid #f0a500; background:#fff8e5; } @media (max-width:30rem) { .page-heading, .card { align-items:stretch; flex-direction:column; } .page-heading button { width:100%; margin:0; } .actions { display:flex; } .actions button { flex:1; } }
  `,
})
export class AccountsPage {
  readonly accountsService = inject(AccountsService);
  readonly pendingForms = inject(PendingFormService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly archiveConfirmation = viewChild<ElementRef<HTMLElement>>("archiveConfirmation");
  readonly form = this.formBuilder.nonNullable.group({
    name: ["", [Validators.required, codePointLengthValidator(1, 100, (value) => value.trim())]],
    type: ["checking" as AccountType, [Validators.required]],
    initialBalance: ["0.00", [Validators.required, signedMoneyValidator]],
    acknowledgeBalanceChange: [false],
  });
  readonly accounts = signal<Account[]>([]);
  readonly includeArchived = signal(false);
  readonly isLoading = signal(false);
  private readonly addButton = viewChild<ElementRef<HTMLButtonElement>>("addAccountButton");
  readonly listError = signal<string | null>(null);
  readonly isSubmitting = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly announcement = signal<string | null>(null);
  readonly fieldErrors = signal<Record<string, string>>({});
  readonly editingAccount = signal<Account | null>(null);
  readonly formOpen = signal(false);
  readonly archiveTarget = signal<Account | null>(null);
  readonly archivePending = signal(false);
  private listRequest = 0;
  private archiveTrigger: HTMLButtonElement | null = null;

  constructor() {
    this.form.controls.initialBalance.valueChanges.subscribe(() => {
      if (!this.balanceChanged()) this.form.controls.acknowledgeBalanceChange.setErrors(null);
    });
    this.form.controls.acknowledgeBalanceChange.valueChanges.subscribe((checked) => {
      if (checked) this.form.controls.acknowledgeBalanceChange.setErrors(null);
    });
    this.loadList();
  }

  formatMoney = formatMoney;
  accountTypeLabel(type: AccountType): string { return type === "credit_card" ? "Credit card" : type[0].toUpperCase() + type.slice(1); }

  loadList(refreshMessage?: string): void {
    const request = ++this.listRequest;
    this.isLoading.set(true); this.listError.set(null);
    this.accountsService.list(this.includeArchived()).subscribe({
      next: (rows) => { if (request === this.listRequest) this.accounts.set(rows); },
      error: (error: unknown) => { if (request === this.listRequest) { this.isLoading.set(false); this.listError.set(refreshMessage ? `${refreshMessage} ${this.errorMessage(error, "Retry the refresh.")}` : this.errorMessage(error, "Could not load accounts.")); } },
      complete: () => { if (request === this.listRequest) this.isLoading.set(false); },
    });
  }
  toggleArchived(event: Event): void { this.includeArchived.set((event.target as HTMLInputElement).checked); this.loadList(); }

  startAdd(): void {
    this.editingAccount.set(null); this.formOpen.set(true); this.saveError.set(null); this.announcement.set(null); this.fieldErrors.set({}); this.form.reset({ name: "", type: "checking", initialBalance: "0.00", acknowledgeBalanceChange: false });
  }

  startEdit(account: Account): void {
    this.saveError.set(null); this.announcement.set(null); this.fieldErrors.set({}); this.accountsService.get(account.id).subscribe({
      next: (detail) => { if (detail.isArchived) { this.formOpen.set(false); this.editingAccount.set(null); this.saveError.set("That account is archived and read-only."); this.loadList(); return; } this.editingAccount.set(detail); this.formOpen.set(true); this.form.reset({ name: detail.name, type: detail.type, initialBalance: signedMoneyInput(detail.initialBalance), acknowledgeBalanceChange: false }); },
      error: (error: unknown) => { this.saveError.set(this.errorMessage(error, "That account is no longer available.")); this.loadList(); },
    });
  }

  cancelForm(): void { if (!this.isSubmitting()) { this.formOpen.set(false); this.editingAccount.set(null); } }

  save(): void {
    this.saveError.set(null); this.fieldErrors.set({}); this.form.markAllAsTouched();
    const raw = this.form.getRawValue(); const cents = parseSignedMoney(raw.initialBalance);
    if (this.isSubmitting() || this.archivePending() || this.form.invalid || cents === null) return;
    const original = this.editingAccount();
    if (original && cents !== original.initialBalance && !raw.acknowledgeBalanceChange) { this.form.controls.acknowledgeBalanceChange.setErrors({ required: true }); return; }
    this.isSubmitting.set(true);
    const body = { name: raw.name.trim(), type: raw.type, initialBalance: cents };
    const write = original ? this.accountsService.update(original.id, body) : this.accountsService.create(body);
    this.pendingForms.setPending(true);
    write.subscribe({
      next: () => { this.pendingForms.setPending(false); this.isSubmitting.set(false); this.formOpen.set(false); this.editingAccount.set(null); this.announcement.set(original ? "Account updated." : "Account saved."); this.loadList("Saved, but the account list could not be refreshed."); },
      error: (error: unknown) => { this.pendingForms.setPending(false); this.isSubmitting.set(false); this.applyServerError(error, "Could not save account."); },
    });
  }

  beginArchive(account: Account): void { this.archiveTrigger = (document.activeElement as HTMLButtonElement) ?? null; this.archiveTarget.set(account); queueMicrotask(() => this.archiveConfirmation()?.nativeElement.focus()); }
  cancelArchive(): void { this.archiveTarget.set(null); queueMicrotask(() => this.archiveTrigger?.focus()); }
  confirmArchive(): void {
    const target = this.archiveTarget(); if (!target || this.archivePending() || this.isSubmitting()) return;
    this.archivePending.set(true); this.pendingForms.setPending(true); this.accountsService.archive(target.id).subscribe({
      next: () => { this.pendingForms.setPending(false); this.archivePending.set(false); this.archiveTarget.set(null); if (this.editingAccount()?.id === target.id) { this.formOpen.set(false); this.editingAccount.set(null); } this.announcement.set("Account archived."); this.loadList(); queueMicrotask(() => this.addButton()?.nativeElement.focus()); },
      error: (error: unknown) => { this.pendingForms.setPending(false); this.archivePending.set(false); this.saveError.set(this.errorMessage(error, "Could not archive account.")); if (error instanceof HttpErrorResponse && error.status === 404) this.loadList(); },
    });
  }

  fieldError(field: string): string { if (field === "acknowledgeBalanceChange" && this.form.controls.acknowledgeBalanceChange.hasError("required")) return "Please acknowledge the balance change."; const server = this.fieldErrors()[field]; if (server) return server; const control = this.form.get(field); if (!control?.touched) return ""; if (control.hasError("required")) return "This field is required."; if (control.hasError("minlength")) return "Use at least 1 character."; if (control.hasError("maxlength")) return "Use no more than 100 characters."; return ""; }
  balanceChanged(): boolean { const original = this.editingAccount(); const cents = parseSignedMoney(this.form.controls.initialBalance.value); return !!original && cents !== null && cents !== original.initialBalance; }
  initialBalanceError(): string { return this.form.controls.initialBalance.touched && this.form.controls.initialBalance.invalid ? (this.fieldErrors()["initialBalance"] ?? "Enter a valid amount with up to two decimals.") : (this.fieldErrors()["initialBalance"] ?? ""); }

  private applyServerError(error: unknown, fallback: string): void { if (error instanceof HttpErrorResponse && error.error?.error?.fields) this.fieldErrors.set(error.error.error.fields); this.saveError.set(this.errorMessage(error, fallback)); }
  private errorMessage(error: unknown, fallback: string): string { if (error instanceof HttpErrorResponse && error.status === 0) return "Could not connect. Check your connection and try again."; return error instanceof HttpErrorResponse && typeof error.error?.error?.message === "string" ? error.error.error.message : fallback; }
}
