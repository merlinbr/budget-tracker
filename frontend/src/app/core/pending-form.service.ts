import { DestroyRef, Injectable, computed, signal } from "@angular/core";

@Injectable({ providedIn: "root" })
export class PendingFormService {
  private readonly count = signal(0);
  readonly pending = computed(() => this.count() > 0);

  begin(owner: DestroyRef): () => void {
    this.count.update((count) => count + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      unregister();
      this.count.update((count) => count - 1);
    };
    const unregister = owner.onDestroy(release);
    return release;
  }
}
