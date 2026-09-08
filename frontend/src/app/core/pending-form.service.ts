import { Injectable, signal } from "@angular/core";

@Injectable({ providedIn: "root" })
export class PendingFormService {
  private readonly _pending = signal(false);
  readonly pending = this._pending.asReadonly();
  setPending(value: boolean): void { this._pending.set(value); }
}
