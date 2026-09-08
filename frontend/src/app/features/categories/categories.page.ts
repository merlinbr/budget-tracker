import { HttpErrorResponse } from "@angular/common/http";
import { Component, ElementRef, inject, signal, viewChild } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";

import { Category, CategoryType } from "../../core/api/models";
import { PendingFormService } from "../../core/pending-form.service";
import { codePointLengthValidator } from "../../shared/utilities/validators";
import { CategoriesService } from "./categories.service";

@Component({
  selector: "app-categories-page",
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <section class="page" aria-labelledby="categories-title">
      <div class="page-heading"><div><p class="eyebrow">Labels for transactions</p><h2 id="categories-title">Categories</h2></div><button #addCategoryButton type="button" (click)="startAdd()" [disabled]="isSubmitting() || archivePending()">Add category</button></div>
      <label class="toggle"><input type="checkbox" [checked]="includeArchived()" (change)="toggleArchived($event)" [disabled]="isLoading() || isSubmitting()" /> Show archived categories</label>
      @if (isLoading()) { <p role="status" aria-live="polite">Loading categories…</p> }
      @if (listError(); as error) { <p class="message error" role="alert">{{ error }} <button type="button" (click)="loadList()">Retry</button></p> }
      @if (saveError(); as error) { <p class="message error" role="alert">{{ error }}</p> }
      @if (announcement(); as message) { <p class="message" role="status" aria-live="polite">{{ message }}</p> }
      @if (!isLoading() && !listError() && categories().length === 0) { <p class="empty">No categories yet. <button type="button" (click)="startAdd()">Add a category</button></p> }
      @for (type of categoryTypes; track type) {
        <section aria-labelledby="{{ type }}-categories-title"><h3 [id]="type + '-categories-title'">{{ type === "expense" ? "Expense" : "Income" }} Categories</h3>
          @if (!isLoading() && !listError() && group(type).length === 0) { <p class="empty">No {{ type }} categories{{ includeArchived() ? " (including archived)" : "" }}.</p> }
          @else { <ul class="cards">@for (category of group(type); track category.id) { <li class="card" [class.archived]="category.isArchived"><div><strong>{{ category.name }}</strong>@if (category.isArchived) { <p class="status">Archived (read-only)</p> }</div>@if (!category.isArchived) { <div class="actions"><button type="button" (click)="startEdit(category)" [disabled]="isSubmitting() || archivePending()" [attr.aria-label]="'Edit category ' + category.name">Edit</button><button type="button" (click)="beginArchive(category)" [disabled]="isSubmitting() || archivePending()" [attr.aria-label]="'Archive category ' + category.name">Archive</button></div> }</li> } </ul> }
        </section>
      }
      @if (archiveTarget(); as target) { <section class="confirm" #archiveConfirmation tabindex="-1" aria-labelledby="archive-title"><h3 id="archive-title">Archive {{ target.name }}?</h3><p>This category will be hidden from the active list.</p><button type="button" (click)="confirmArchive()" [disabled]="archivePending()">{{ archivePending() ? "Archiving…" : "Confirm archive" }}</button><button type="button" (click)="cancelArchive()" [disabled]="archivePending()">Cancel</button></section> }
      @if (formOpen()) { <form [formGroup]="form" (ngSubmit)="save()" aria-labelledby="category-form-title" [attr.aria-busy]="isSubmitting()"><h3 id="category-form-title">{{ editingCategory() ? "Edit category" : "Add category" }}</h3><div class="field"><label for="category-name">Name</label><input id="category-name" type="text" formControlName="name" aria-describedby="category-name-error" [attr.aria-invalid]="fieldError('name') ? 'true' : null" /><p id="category-name-error" class="field-error" aria-live="polite">{{ fieldError("name") }}</p></div>@if (!editingCategory()) { <div class="field"><label for="category-type">Type</label><select id="category-type" formControlName="type" aria-describedby="category-type-error"><option value="expense">Expense</option><option value="income">Income</option></select><p id="category-type-error" class="field-error" aria-live="polite">{{ fieldError("type") }}</p></div> } @else { <p><strong>Type:</strong> {{ editingCategory()!.type === "expense" ? "Expense" : "Income" }} (cannot change when editing)</p> }<button type="submit" [disabled]="isSubmitting()">{{ isSubmitting() ? "Saving…" : "Save category" }}</button><button type="button" (click)="cancelForm()" [disabled]="isSubmitting()">Cancel</button></form> }
    </section>
  `,
  styles: `
    :host { display:block; } .page { max-width:52rem; margin:auto; } .page-heading { display:flex; justify-content:space-between; align-items:start; gap:1rem; } h2 { margin-top:.5rem; } h3 { margin-top:1.5rem; } button { min-height:2.75rem; margin:.25rem; padding:.5rem .8rem; border:0; border-radius:.375rem; background:#1b4d8f; color:#fff; cursor:pointer; font:inherit; font-weight:700; } button:disabled { opacity:.65; cursor:wait; } button:focus-visible, input:focus-visible, select:focus-visible, section[tabindex]:focus-visible { outline:3px solid #f0a500; outline-offset:2px; } .toggle { display:block; margin:1rem 0; } .cards { display:grid; gap:.75rem; padding:0; list-style:none; } .card { display:flex; justify-content:space-between; gap:1rem; align-items:center; padding:1rem; border:1px solid #d7deeb; border-radius:.75rem; background:#fff; } .card p { margin:.35rem 0 0; color:#52617a; } .archived { opacity:.8; } .status { font-weight:700; } form, .confirm { margin-top:1.5rem; padding:1rem; border:1px solid #d7deeb; border-radius:.75rem; background:#fff; } .field { margin:1rem 0; } label { font-weight:700; } input, select { box-sizing:border-box; display:block; width:100%; min-height:2.75rem; margin-top:.35rem; padding:.5rem; font:inherit; } input[type=checkbox] { display:inline; width:auto; min-height:auto; margin-right:.4rem; } .field-error { min-height:1.3rem; margin:.25rem 0 0; color:#7c1717; } .message { padding:.75rem; border-radius:.375rem; } .error { background:#fff0f0; color:#7c1717; } .empty { padding:1rem; border:1px dashed #aab5c8; } @media (max-width:30rem) { .page-heading, .card { align-items:stretch; flex-direction:column; } .page-heading button { width:100%; margin:0; } .actions { display:flex; } .actions button { flex:1; } }
  `,
})
export class CategoriesPage {
  readonly pendingForms = inject(PendingFormService);
  readonly categoriesService = inject(CategoriesService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly archiveConfirmation = viewChild<ElementRef<HTMLElement>>("archiveConfirmation");
  private readonly addButton = viewChild<ElementRef<HTMLButtonElement>>("addCategoryButton");
  readonly form = this.formBuilder.nonNullable.group({ name: ["", [Validators.required, codePointLengthValidator(1, 100, (value) => value.trim())]], type: ["expense" as CategoryType, [Validators.required]] });
  readonly categoryTypes: CategoryType[] = ["expense", "income"];
  readonly categories = signal<Category[]>([]);
  readonly includeArchived = signal(false);
  readonly isLoading = signal(false);
  readonly announcement = signal<string | null>(null);
  readonly listError = signal<string | null>(null);
  readonly isSubmitting = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly fieldErrors = signal<Record<string, string>>({});
  readonly editingCategory = signal<Category | null>(null);
  readonly formOpen = signal(false);
  readonly archiveTarget = signal<Category | null>(null);
  readonly archivePending = signal(false);
  private listRequest = 0;
  private detailRequest = 0;
  private archiveTrigger: HTMLButtonElement | null = null;

  constructor() { this.loadList(); }
  startAdd(): void { ++this.detailRequest; this.editingCategory.set(null); this.formOpen.set(true); this.saveError.set(null); this.announcement.set(null); this.fieldErrors.set({}); this.form.reset({ name: "", type: "expense" }); }
  group(type: CategoryType): Category[] { return this.categories().filter((category) => category.type === type); }
  loadList(refreshMessage?: string): void { const request = ++this.listRequest; this.isLoading.set(true); this.listError.set(null); this.categoriesService.list(this.includeArchived()).subscribe({ next: (rows) => { if (request === this.listRequest) this.categories.set(rows); }, error: (error: unknown) => { if (request === this.listRequest) { this.isLoading.set(false); this.listError.set(refreshMessage ? `${refreshMessage} ${this.errorMessage(error, "Retry the refresh.")}` : this.errorMessage(error, "Could not load categories.")); } }, complete: () => { if (request === this.listRequest) this.isLoading.set(false); } }); }
  toggleArchived(event: Event): void { this.includeArchived.set((event.target as HTMLInputElement).checked); this.loadList(); }
  startEdit(category: Category): void { this.saveError.set(null); this.announcement.set(null); this.fieldErrors.set({}); const request = ++this.detailRequest; this.categoriesService.get(category.id).subscribe({ next: (detail) => { if (request !== this.detailRequest) return; if (detail.isArchived) { this.formOpen.set(false); this.editingCategory.set(null); this.saveError.set("That category is archived and read-only."); this.loadList(); return; } this.editingCategory.set(detail); this.formOpen.set(true); this.form.reset({ name: detail.name, type: detail.type }); }, error: (error: unknown) => { if (request !== this.detailRequest) return; this.saveError.set(this.errorMessage(error, "That category is no longer available.")); this.loadList(); } }); }
  cancelForm(): void { if (!this.isSubmitting()) { ++this.detailRequest; this.formOpen.set(false); this.editingCategory.set(null); } }
  save(): void { this.saveError.set(null); this.announcement.set(null); this.fieldErrors.set({}); this.form.markAllAsTouched(); if (this.isSubmitting() || this.archivePending() || this.form.invalid) return; const raw = this.form.getRawValue(); this.isSubmitting.set(true); const editing = this.editingCategory(); const write = editing ? this.categoriesService.update(editing.id, { name: raw.name.trim() }) : this.categoriesService.create({ name: raw.name.trim(), type: raw.type }); this.pendingForms.setPending(true); write.subscribe({ next: () => { this.pendingForms.setPending(false); this.isSubmitting.set(false); this.formOpen.set(false); this.editingCategory.set(null); this.announcement.set(editing ? "Category updated." : "Category saved."); this.loadList("Saved, but the category list could not be refreshed."); }, error: (error: unknown) => { this.pendingForms.setPending(false); this.isSubmitting.set(false); this.applyServerError(error, "Could not save category."); } }); }
  beginArchive(category: Category): void { this.archiveTrigger = (document.activeElement as HTMLButtonElement) ?? null; this.archiveTarget.set(category); queueMicrotask(() => this.archiveConfirmation()?.nativeElement.focus()); }
  cancelArchive(): void { this.archiveTarget.set(null); queueMicrotask(() => this.archiveTrigger?.focus()); }
  confirmArchive(): void { const target = this.archiveTarget(); if (!target || this.archivePending() || this.isSubmitting()) return; this.archivePending.set(true); this.pendingForms.setPending(true); this.categoriesService.archive(target.id).subscribe({ next: () => { this.pendingForms.setPending(false); this.archivePending.set(false); this.archiveTarget.set(null); if (this.editingCategory()?.id === target.id) { this.formOpen.set(false); this.editingCategory.set(null); } this.announcement.set("Category archived."); this.loadList(); queueMicrotask(() => this.addButton()?.nativeElement.focus()); }, error: (error: unknown) => { this.pendingForms.setPending(false); this.archivePending.set(false); this.saveError.set(this.errorMessage(error, "Could not archive category.")); if (error instanceof HttpErrorResponse && error.status === 404) this.loadList(); } }); }
  fieldError(field: string): string { const server = this.fieldErrors()[field]; if (server) return server; const control = this.form.get(field); if (!control?.touched) return ""; if (control.hasError("required")) return "This field is required."; if (control.hasError("minlength")) return "Use at least 1 character."; if (control.hasError("maxlength")) return "Use no more than 100 characters."; return ""; }
  private applyServerError(error: unknown, fallback: string): void { if (error instanceof HttpErrorResponse && error.error?.error?.fields) this.fieldErrors.set(error.error.error.fields); this.saveError.set(this.errorMessage(error, fallback)); }
  private errorMessage(error: unknown, fallback: string): string { if (error instanceof HttpErrorResponse && error.status === 0) return "Could not connect. Check your connection and try again."; return error instanceof HttpErrorResponse && typeof error.error?.error?.message === "string" ? error.error.error.message : fallback; }
}
