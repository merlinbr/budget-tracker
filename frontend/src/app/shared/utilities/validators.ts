import {
  AbstractControl,
  ValidationErrors,
  ValidatorFn,
} from "@angular/forms";

export function codePointLengthValidator(
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
