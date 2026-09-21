import { HttpErrorResponse } from "@angular/common/http";
import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { Router } from "@angular/router";
import { Subject, catchError, finalize, forkJoin, map, of, startWith, switchMap } from "rxjs";

import { Account, Category, ExportFilters, HouseholdDetails } from "../../core/api/models";
import { AuthService } from "../../core/auth/auth.service";
import { PendingFormService } from "../../core/pending-form.service";
import { codePointLengthValidator } from "../../shared/utilities/validators";
import { AccountsService } from "../accounts/accounts.service";
import { CategoriesService } from "../categories/categories.service";
import { SettingsService } from "./settings.service";

type HouseholdState =
  | { kind: "loading" }
  | { kind: "ready"; details: HouseholdDetails }
  | { kind: "error"; message: string };

type SelectorState =
  | { kind: "loading" }
  | { kind: "ready"; accounts: Account[]; categories: Category[] }
  | { kind: "error"; message: string };
type ExportField = "from" | "to" | "accountId" | "categoryId";


@Component({
  selector: "app-settings-page",
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: "./settings.page.html",
  styleUrl: "./settings.page.css",
})
export class SettingsPage {
  readonly auth = inject(AuthService);
  private readonly settings = inject(SettingsService);
  private readonly accounts = inject(AccountsService);
  private readonly categories = inject(CategoriesService);
  private readonly pendingForms = inject(PendingFormService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly householdRequests = new Subject<void>();
  private readonly selectorRequests = new Subject<void>();
  private exportRequest = 0;


  readonly profileForm = this.formBuilder.nonNullable.group({
    displayName: [
      "",
      [Validators.required, codePointLengthValidator(1, 100)],
    ],
  });
  readonly passwordForm = this.formBuilder.nonNullable.group(
    {
      currentPassword: [
        "",
        [Validators.required, codePointLengthValidator(12, 1024)],
      ],
      newPassword: [
        "",
        [Validators.required, codePointLengthValidator(12, 1024)],
      ],
      confirmPassword: ["", Validators.required],
    },
    { validators: this.confirmationMatches },
  );

  readonly householdState = signal<HouseholdState>({ kind: "loading" });
  readonly selectorState = signal<SelectorState>({ kind: "loading" });
  readonly savingProfile = signal(false);
  readonly changingPassword = signal(false);
  readonly downloading = signal(false);
  readonly profileError = signal<string | null>(null);
  readonly profileAnnouncement = signal<string | null>(null);
  readonly passwordError = signal<string | null>(null);
  readonly passwordFieldError = signal<string | null>(null);
  readonly confirmationMismatch = signal(false);
  readonly confirmationMismatchMessage = "The passwords do not match.";
  readonly exportError = signal<string | null>(null);
  readonly exportFieldErrors = signal<Partial<Record<ExportField, string>>>({});
  readonly exportAnnouncement = signal<string | null>(null);
  readonly filters = signal<ExportFilters>({});
  readonly pending = computed(
    () => this.savingProfile() || this.changingPassword(),
  );
  readonly username = computed(() => {
    const state = this.auth.authState();
    return state ? state.user.username : "";
  });

  constructor() {
    this.applyInitialProfile();
    this.householdRequests.pipe(
      switchMap(() =>
        this.settings.household().pipe(
          map((details): HouseholdState => ({ kind: "ready", details })),
          catchError(() => of<HouseholdState>({
            kind: "error",
            message: "Could not load household details.",
          })),
          startWith<HouseholdState>({ kind: "loading" }),
        ),
      ),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((state) => this.householdState.set(state));
    this.selectorRequests.pipe(
      switchMap(() =>
        forkJoin({
          accounts: this.accounts.list(true).pipe(
            map((accounts) => ({ ok: true as const, accounts })),
            catchError(() => of({ ok: false as const, accounts: [] })),
          ),
          categories: this.categories.list(true).pipe(
            map((categories) => ({ ok: true as const, categories })),
            catchError(() => of({ ok: false as const, categories: [] })),
          ),
        }).pipe(
          map(({ accounts, categories }): SelectorState =>
            accounts.ok && categories.ok
              ? { kind: "ready", accounts: accounts.accounts, categories: categories.categories }
              : { kind: "error", message: "Could not load account and category filters." },
          ),
          startWith<SelectorState>({ kind: "loading" }),
        ),
      ),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((state) => this.selectorState.set(state));
    this.retryHousehold();
    this.retrySelectors();
  }

  retryHousehold(): void {
    this.householdRequests.next();
  }

  private applyInitialProfile(): void {
    const user = this.auth.authState()?.user;
    if (user) {
      this.profileForm.patchValue({ displayName: user.displayName });
    }
  }

  retrySelectors(): void {
    this.selectorRequests.next();
  }

  saveProfile(): void {
    if (this.pending()) return;
    this.profileError.set(null);
    this.profileAnnouncement.set(null);
    this.profileForm.markAllAsTouched();
    if (this.profileForm.invalid) return;
    const displayName = this.profileForm.getRawValue().displayName.trim();
    this.savingProfile.set(true);
    this.pendingForms.setPending(true);
    this.auth.updateDisplayName(displayName)
      .pipe(
        finalize(() => {
          if (!this.destroyRef.destroyed) {
            this.savingProfile.set(false);
            this.pendingForms.setPending(false);
          }
        }),
      )
      .subscribe({
        next: (user) => {
          if (this.destroyRef.destroyed) return;
          const state = this.householdState();
          if (state.kind === "ready") {
            this.householdState.set({
              kind: "ready",
              details: {
                ...state.details,
                members: state.details.members.map((member) =>
                  member.id === user.id ? { ...member, displayName: user.displayName } : member,
                ),
              },
            });
          }
          this.profileError.set(null);
          this.profileAnnouncement.set("Profile saved.");
        },
        error: (error: unknown) => {
          if (this.destroyRef.destroyed) return;
          this.profileError.set(this.errorMessage(error, "Could not save profile."));
        },
      });
  }

  changePassword(): void {
    if (this.pending()) return;
    this.passwordError.set(null);
    this.passwordFieldError.set(null);
    this.passwordForm.markAllAsTouched();
    const mismatch = this.passwordForm.hasError("mismatch");
    this.confirmationMismatch.set(mismatch);
    if (this.passwordForm.invalid) return;
    const { currentPassword, newPassword } = this.passwordForm.getRawValue();
    this.changingPassword.set(true);
    this.pendingForms.setPending(true);
    this.auth.changePassword(currentPassword, newPassword)
      .pipe(
        finalize(() => {
          if (!this.destroyRef.destroyed) {
            this.changingPassword.set(false);
            this.pendingForms.setPending(false);
          }
        }),
      )
      .subscribe({
        next: () => {
          // Clear secret inputs before leaving the page.
          this.passwordForm.reset();
          // AuthService.clear() already ran via the tap; navigate to Login with notice.
          void this.router.navigate(["/login"], {
            state: { passwordChanged: true },
          });
        },
        error: (error: unknown) => {
          if (this.destroyRef.destroyed) return;
          if (
            error instanceof HttpErrorResponse &&
            typeof error.error?.error?.fields?.currentPassword === "string"
          ) {
            this.passwordFieldError.set(
              error.error.error.fields.currentPassword,
            );
          }
          this.passwordError.set(this.errorMessage(error, "Could not change password."));
        },
      });
  }

  applyFilter(name: "from" | "to" | "accountId" | "categoryId", value: string): void {
    const current = { ...this.filters() };
    const trimmed = value === undefined || value === "" ? undefined : value;
    if (name === "accountId" || name === "categoryId") {
      const id = trimmed === undefined ? undefined : Number(trimmed);
      if (id !== undefined && Number.isSafeInteger(id) && id > 0) {
        current[name] = id;
      } else {
        delete current[name];
      }
    } else {
      if (trimmed === undefined) delete current[name];
      else current[name] = trimmed;
    }
    this.filters.set(current);
  }

  downloadCsv(): void {
    if (this.downloading()) return;
    const request = ++this.exportRequest;
    this.exportError.set(null);
    this.exportAnnouncement.set(null);
    this.exportFieldErrors.set({});
    const activeFilters: ExportFilters = { ...this.filters() };
    const selectorView = this.selectorState();
    if (selectorView.kind !== "ready") {
      delete activeFilters.accountId;
      delete activeFilters.categoryId;
    } else {
      if (
        activeFilters.accountId !== undefined &&
        !selectorView.accounts.some((account) => account.id === activeFilters.accountId)
      ) {
        delete activeFilters.accountId;
      }
      if (
        activeFilters.categoryId !== undefined &&
        !selectorView.categories.some((category) => category.id === activeFilters.categoryId)
      ) {
        delete activeFilters.categoryId;
      }
    }
    if (
      activeFilters.from &&
      activeFilters.to &&
      activeFilters.from > activeFilters.to
    ) {
      const message = "The from date must be on or before the to date.";
      this.exportFieldErrors.set({ from: message, to: message });
      this.exportError.set(message);
      return;
    }
    this.downloading.set(true);
    this.settings.exportTransactions(activeFilters)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          if (!this.destroyRef.destroyed && request === this.exportRequest) {
            this.downloading.set(false);
          }
        }),
      )
      .subscribe({
        next: (blob) => {
          if (!this.isCurrentExport(request)) return;
          if (blob.type.toLowerCase().startsWith("application/json")) {
            this.exportError.set("The export failed. You can retry.");
            return;
          }
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = "transactions.csv";
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          URL.revokeObjectURL(url);
          this.exportAnnouncement.set("Download started.");
        },
        error: (error: unknown) => {
          if (!this.isCurrentExport(request)) return;
          this.exportFieldErrors.set(this.exportFieldMessages(error));
          this.exportError.set(this.errorMessage(error, "Could not download the CSV."));
        },
      });
  }
  exportFieldError(field: ExportField): string | null {
    return this.exportFieldErrors()[field] ?? null;
  }


  private isCurrentExport(request: number): boolean {
    return !this.destroyRef.destroyed && request === this.exportRequest;
  }

  private exportFieldMessages(error: unknown): Partial<Record<ExportField, string>> {
    if (!(error instanceof HttpErrorResponse)) return {};
    const payload: unknown = error.error;
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || !("error" in payload)) {
      return {};
    }
    const envelope = payload.error;
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || !("fields" in envelope)) {
      return {};
    }
    const fields = envelope.fields;
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) return {};
    const messages: Partial<Record<ExportField, string>> = {};
    for (const [field, message] of Object.entries(fields)) {
      if (
        (field === "from" || field === "to" || field === "accountId" || field === "categoryId") &&
        typeof message === "string"
      ) {
        messages[field] = message;
      }
    }
    return messages;
  }

  fieldError(field: "displayName"): string | null {
    const control = this.profileForm.controls[field];
    if (!control.touched || control.valid) return null;
    if (control.hasError("required")) return "Enter a display name.";
    if (control.hasError("minlength")) return "Display name must contain at least 1 character.";
    if (control.hasError("maxlength")) return "Display name must contain at most 100 characters.";
    return null;
  }

  passwordFieldHint(field: "currentPassword" | "newPassword" | "confirmPassword"): string | null {
    const control = this.passwordForm.controls[field];
    if (!control.touched || control.valid) return null;
    if (control.hasError("required")) return field === "confirmPassword" ? "Repeat the new password." : "Enter a password with at least 12 characters.";
    const group = this.passwordForm.errors;
    if (field === "confirmPassword" && group && "mismatch" in group) {
      return "The passwords do not match.";
    }
    if (control.hasError("minlength") || control.hasError("maxlength")) {
      return "Use 12 to 1024 characters.";
    }
    return null;
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.status === 0) {
      return "Could not connect. Check your connection and try again.";
    }
    return error instanceof HttpErrorResponse && typeof error.error?.error?.message === "string"
      ? error.error.error.message
      : fallback;
  }

  private confirmationMatches(group: {
    value: { newPassword: string; confirmPassword: string };
  }) {
    return group.value.newPassword === group.value.confirmPassword
      ? null
      : { mismatch: true };
  }
}
