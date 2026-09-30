import { Component, DestroyRef, inject } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { vi } from "vitest";
import { PendingFormService } from "./pending-form.service";

@Component({ standalone: true, template: "" })
class OwnerComponent {
  readonly destroyRef = inject(DestroyRef);
}

describe("PendingFormService", () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [OwnerComponent] }));

  it("counts independent acquisitions and makes release idempotent", () => {
    const service = TestBed.inject(PendingFormService);
    const owner = TestBed.createComponent(OwnerComponent);
    expect(service.pending()).toBe(false);
    const first = service.begin(owner.componentInstance.destroyRef);
    const second = service.begin(owner.componentInstance.destroyRef);
    first();
    first();
    expect(service.pending()).toBe(true);
    second();
    second();
    expect(service.pending()).toBe(false);
    owner.destroy();
    expect(service.pending()).toBe(false);
  });

  it("releases a destroyed owner without allowing late cleanup to release a new owner", () => {
    const service = TestBed.inject(PendingFormService);
    const oldOwner = TestBed.createComponent(OwnerComponent);
    const releaseOld = service.begin(oldOwner.componentInstance.destroyRef);
    oldOwner.destroy();
    expect(service.pending()).toBe(false);
    const newOwner = TestBed.createComponent(OwnerComponent);
    const releaseNew = service.begin(newOwner.componentInstance.destroyRef);
    releaseOld();
    expect(service.pending()).toBe(true);
    releaseNew();
    expect(service.pending()).toBe(false);
  });

  it("unregisters the owner callback when an operation settles", () => {
    const service = TestBed.inject(PendingFormService);
    const owner = TestBed.createComponent(OwnerComponent);
    const ref = owner.componentInstance.destroyRef;
    const original = ref.onDestroy.bind(ref);
    const unregister = vi.fn();
    vi.spyOn(ref, "onDestroy").mockImplementation((callback) => {
      const remove = original(callback);
      return () => { unregister(); remove(); };
    });
    const release = service.begin(ref);
    release();
    release();
    expect(unregister).toHaveBeenCalledTimes(1);
    owner.destroy();
    expect(service.pending()).toBe(false);
  });
});
