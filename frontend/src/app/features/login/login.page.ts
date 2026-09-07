import { HttpErrorResponse } from "@angular/common/http";
import { Component, inject, signal } from "@angular/core";
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from "@angular/forms";
import { Router } from "@angular/router";

import { AuthService } from "../../core/auth/auth.service";

function codePointLengthValidator(
  minimum: number | undefined,
  maximum: number,
  normalize: (value: string) => string = (value) => value,
): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const rawValue = typeof control.value === "string" ? control.value : "";
    const actualLength = Array.from(normalize(rawValue)).length;
    if (minimum !== undefined && actualLength < minimum) {
      return { minlength: { requiredLength: minimum, actualLength } };
    }
    if (actualLength > maximum) {
      return { maxlength: { requiredLength: maximum, actualLength } };
    }
    return null;
  };
}

@Component({
  selector: "app-login-page",
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: "./login.page.html",
  styleUrl: "./login.page.css",
})
export class LoginPage {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);
  readonly form = this.formBuilder.nonNullable.group({
    username: [
      "",
      [
        Validators.required,
        codePointLengthValidator(undefined, 100, (value) => value.trim()),
      ],
    ],
    password: [
      "",
      [Validators.required, codePointLengthValidator(12, 1024)],
    ],
  });
  readonly isSubmitting = signal(false);
  readonly isRetrying = signal(false);
  readonly submitError = signal<string | null>(null);
  readonly restoreError = signal<string | null>(null);

  submit(): void {
    this.submitError.set(null);
    this.form.markAllAsTouched();
    if (this.form.invalid || this.isSubmitting()) {
      return;
    }

    this.isSubmitting.set(true);
    const { username: rawUsername, password } = this.form.getRawValue();
    const username = rawUsername.trim().toLowerCase();
    this.auth.login(username, password).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        void this.router.navigateByUrl("/dashboard");
      },
      error: (error: unknown) => {
        this.isSubmitting.set(false);
        this.submitError.set(this.loginError(error));
      },
    });
  }

  retryRestore(): void {
    if (this.isRetrying()) {
      return;
    }
    this.restoreError.set(null);
    this.isRetrying.set(true);
    this.auth.restore().subscribe({
      next: (state) => {
        this.isRetrying.set(false);
        if (state) {
          void this.router.navigateByUrl("/dashboard");
        }
      },
      error: () => {
        this.isRetrying.set(false);
        this.restoreError.set(
          "The session could not be restored. Check your connection and try again.",
        );
      },
    });
  }

  fieldError(field: "username" | "password"): string | null {
    const control = this.form.controls[field];
    if (!control.touched && !control.dirty) {
      return null;
    }
    if (control.hasError("required")) {
      return field === "username"
        ? "Username is required."
        : "Password is required.";
    }
    if (control.hasError("maxlength")) {
      return field === "username"
        ? "Username must be 100 characters or fewer."
        : "Password must be 1024 characters or fewer.";
    }
    if (control.hasError("minlength")) {
      return "Password must be at least 12 characters.";
    }
    return null;
  }

  private loginError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 401) {
        return "Invalid username or password.";
      }
      if (error.status === 403) {
        return "Your sign-in request could not be verified. Refresh the page and try again.";
      }
      if (error.status === 429) {
        return "Too many sign-in attempts. Try again later.";
      }
      if (error.status === 0 || error.status >= 500) {
        return "The service is unavailable. Check your connection and try again.";
      }
    }
    return "Sign-in failed. Please try again.";
  }
}
