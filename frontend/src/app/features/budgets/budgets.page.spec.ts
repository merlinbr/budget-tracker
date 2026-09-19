import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";

import { Budget, Category } from "../../core/api/models";
import { pendingFormGuard } from "../../core/auth/auth.guard";
import { authInterceptor } from "../../core/auth/auth.interceptor";
import { PendingFormService } from "../../core/pending-form.service";
import { localToday } from "../../shared/utilities/money";
import { BudgetsPage } from "./budgets.page";

const categories: Category[] = [
  { id: 3, name: "Groceries", type: "expense", isArchived: false },
  { id: 4, name: "Transport", type: "expense", isArchived: false },
  { id: 5, name: "Salary", type: "income", isArchived: false },
];
const baseBudget: Budget = {
  categoryId: 3, categoryName: "Groceries", isArchived: false, year: 2026, month: 9,
  limitAmount: 60000, spent: 8472, remaining: 51528, progress: 0.1412,
};

// Drive the rendered form so parsing, pending state and HTTP behavior stay linked.
describe("BudgetsPage", () => {
  let fixture: ComponentFixture<BudgetsPage>;
  let http: HttpTestingController;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BudgetsPage],
      providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(BudgetsPage);
    root = fixture.nativeElement;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function reads() {
    return {
      categories: http.expectOne((request) => request.url === "/api/categories"),
      budgets: http.expectOne((request) => request.url === "/api/budgets"),
    };
  }

  function ready(budgets: Budget[] = [], active = categories): void {
    const requests = reads();
    requests.categories.flush(active);
    requests.budgets.flush(budgets);
    fixture.detectChanges();
  }

  function row(name = "Groceries"): HTMLElement {
    const match = [...root.querySelectorAll<HTMLLIElement>("li")].find((item) => item.querySelector("h3")?.textContent?.trim() === name);
    if (!match) throw new Error(`Missing category ${name}`);
    return match;
  }

  function button(label: string, scope: HTMLElement = root): HTMLButtonElement {
    const match = [...scope.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
    if (!match) throw new Error(`Missing button ${label}`);
    return match;
  }

  function click(label: string, scope: HTMLElement = root): void {
    button(label, scope).click();
    fixture.detectChanges();
  }

  function enter(value: string): void {
    const input = root.querySelector<HTMLInputElement>("#budget-limit")!;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    fixture.detectChanges();
  }

  function submit(): void {
    root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }

  it("unions active expense categories with configured archived history, keeping zero distinct from missing", () => {
    ready([
      { ...baseBudget, limitAmount: 0, remaining: -8472, progress: null },
      { ...baseBudget, categoryId: 9, categoryName: "Old groceries", isArchived: true },
    ]);
    expect(root.textContent).not.toContain("Salary");
    expect(row("Transport").textContent).toContain("No budget");
    expect(row().textContent).not.toContain("No budget");
    expect(row().textContent).toContain("Over budget");
    expect(button("Remove budget", row())).toBeTruthy();
    expect(row("Old groceries").textContent).toContain("Archived category");
    click("Edit limit", row("Old groceries"));
    expect(root.querySelector<HTMLInputElement>("#budget-limit")!.value).toBe("600.00");
    expect(button("Set limit", row("Transport")).disabled).toBe(true);
  });

  it("keeps archived-only budgets usable and links genuinely empty households to categories", () => {
    ready([{ ...baseBudget, isArchived: true }], []);
    expect(row().textContent).toContain("Archived category");
    fixture.componentInstance.selectMonth("2026-08");
    ready([], []);
    expect(root.textContent).toContain("No expense categories");
    expect(root.querySelector<HTMLAnchorElement>('a[href="/categories"]')).not.toBeNull();
  });

  it("saves exact comma cents in the selected period and blocks pending actions and navigation", () => {
    ready();
    fixture.componentInstance.selectMonth("2026-09");
    ready();
    click("Set limit", row());
    enter("600,00");
    submit();
    const write = http.expectOne((request) => request.method === "PUT");
    expect(write.request.body).toEqual({ limitAmount: 60000 });
    expect(write.request.params.get("year")).toBe("2026");
    expect(write.request.params.get("month")).toBe("9");
    expect(TestBed.inject(PendingFormService).pending()).toBe(true);
    expect(TestBed.runInInjectionContext(() => pendingFormGuard({} as never, {} as never, {} as never, { url: "/dashboard" } as never))).toBe(false);
    expect(button("Cancel").disabled).toBe(true);
    expect(root.querySelector<HTMLInputElement>('[type="month"]')!.disabled).toBe(true);
    fixture.componentInstance.save();
    fixture.componentInstance.cancelEdit();
    fixture.componentInstance.selectMonth("2026-10");
    fixture.componentInstance.moveMonth(1);
    fixture.componentInstance.copyPrevious();
    http.expectNone((request) => request.method !== "GET");
    expect(fixture.componentInstance.selectedMonth()).toBe("2026-09");
    expect(root.querySelector<HTMLInputElement>("#budget-limit")!.value).toBe("600,00");
    write.flush(baseBudget);
    expect(TestBed.inject(PendingFormService).pending()).toBe(false);
    ready([baseBudget]);
    expect(root.querySelector("form")).toBeNull();
    expect(row().textContent).toContain("600,00");
    expect(TestBed.runInInjectionContext(() => pendingFormGuard({} as never, {} as never, {} as never, { url: "/dashboard" } as never))).toBe(true);
  });

  it("rejects invalid limits with an associated error and never sends a write", () => {
    ready();
    click("Set limit", row());
    expect(root.querySelector<HTMLInputElement>("#budget-limit")!.value).toBe("");
    for (const value of ["", "-1", "1e2", "1,000.00", "1.234", "90071992547409.92"]) {
      enter(value);
      submit();
      const input = root.querySelector<HTMLInputElement>("#budget-limit")!;
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(root.querySelector(`#${input.getAttribute("aria-describedby")}`)!.textContent).toContain("non-negative");
    }
    http.expectNone((request) => request.method === "PUT");
  });

  it("preserves failed-save input and associates server field errors without retrying writes", () => {
    ready();
    click("Set limit", row());
    enter("600,00");
    submit();
    http.expectOne((request) => request.method === "PUT").flush(
      { error: { message: "Not saved", fields: { limitAmount: "Limit was rejected" } } },
      { status: 422, statusText: "Unprocessable Entity" },
    );
    fixture.detectChanges();
    expect(TestBed.inject(PendingFormService).pending()).toBe(false);
    expect(root.querySelector<HTMLInputElement>("#budget-limit")!.value).toBe("600,00");
    expect(root.querySelector("#budget-limit-error")!.textContent).toContain("Limit was rejected");
    expect(button("Save budget").disabled).toBe(false);
    http.expectNone((request) => request.method !== "GET");
  });

  it("preserves interceptor-owned 401 recovery and releases the pending guard", () => {
    ready();
    const navigate = vi.spyOn(TestBed.inject(Router), "navigateByUrl").mockResolvedValue(true);
    click("Set limit", row());
    enter("10");
    submit();
    http.expectOne((request) => request.method === "PUT").flush(null, { status: 401, statusText: "Unauthorized" });
    expect(navigate).toHaveBeenCalledWith("/login");
    expect(TestBed.inject(PendingFormService).pending()).toBe(false);
    expect(TestBed.runInInjectionContext(() => pendingFormGuard({} as never, {} as never, {} as never, { url: "/login" } as never))).toBe(true);
    http.expectNone((request) => request.method === "PUT");
  });

  it("keeps mutation success visible after refresh failure and retries only reads", () => {
    ready();
    click("Set limit", row());
    enter("0");
    submit();
    const write = http.expectOne((request) => request.method === "PUT");
    expect(write.request.body).toEqual({ limitAmount: 0 });
    write.flush({ ...baseBudget, limitAmount: 0, remaining: -8472, progress: null });
    const refresh = reads();
    refresh.categories.flush(categories);
    refresh.budgets.flush(null, { status: 503, statusText: "Unavailable" });
    fixture.detectChanges();
    expect(root.textContent).toContain("Budget saved.");
    expect(root.textContent).toContain("change succeeded, but the refresh failed");
    expect(root.querySelector("li")).toBeNull();
    click("Retry");
    http.expectNone((request) => request.method !== "GET");
    ready([{ ...baseBudget, limitAmount: 0, remaining: -8472, progress: null }]);
    expect(row().textContent).toContain("Over budget");
  });

  it("requires an explicit collision confirmation, supports cancel, and copies the same target only on confirm", async () => {
    ready([baseBudget]);
    fixture.componentInstance.selectMonth("2026-01");
    ready([baseBudget]);
    click("Copy previous month");
    const first = http.expectOne("/api/budgets/copy-previous");
    expect(first.request.body).toEqual({ year: 2026, month: 1, overwrite: false });
    fixture.componentInstance.copyPrevious();
    http.expectNone("/api/budgets/copy-previous");
    first.flush({ error: { fields: { overwrite: "Confirmation required" } } }, { status: 409, statusText: "Conflict" });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(root.querySelector("#copy-confirmation"));
    expect(root.querySelector("#copy-confirmation")!.textContent).toContain("2025-12 to 2026-01");
    expect(button("Edit limit", row()).disabled).toBe(true);
    fixture.componentInstance.selectMonth("2026-02");
    http.expectNone((request) => request.url === "/api/budgets");
    click("Cancel");
    await fixture.whenStable();
    expect(document.activeElement).toBe(button("Copy previous month"));
    http.expectNone("/api/budgets/copy-previous");
    click("Copy previous month");
    http.expectOne("/api/budgets/copy-previous").flush({ error: { fields: { overwrite: "Confirmation required" } } }, { status: 409, statusText: "Conflict" });
    fixture.detectChanges();
    http.expectNone("/api/budgets/copy-previous");
    click("Confirm overwrite");
    const confirmed = http.expectOne("/api/budgets/copy-previous");
    expect(confirmed.request.body).toEqual({ year: 2026, month: 1, overwrite: true });
    expect(button("Cancel").disabled).toBe(true);
    fixture.componentInstance.cancelCopy();
    fixture.componentInstance.copyPrevious(true);
    http.expectNone("/api/budgets/copy-previous");
    confirmed.flush([baseBudget]);
    ready([baseBudget]);
    expect(root.querySelector("#copy-confirmation")).toBeNull();
    expect(root.textContent).toContain("budgets copied");
  });

  it("does not mistake an overflow conflict for permission to overwrite", () => {
    ready();
    click("Copy previous month");
    http.expectOne("/api/budgets/copy-previous").flush(
      { error: { message: "Amount exceeds supported range", fields: { amount: "Overflow" } } },
      { status: 409, statusText: "Conflict" },
    );
    fixture.detectChanges();
    expect(root.textContent).toContain("Amount exceeds supported range");
    expect(root.querySelector("#copy-confirmation")).toBeNull();
    expect(TestBed.inject(PendingFormService).pending()).toBe(false);
    fixture.componentInstance.copyPrevious(true);
    http.expectNone("/api/budgets/copy-previous");
  });

  it("requires removal confirmation, preserves transactions messaging and restores row focus after refresh", async () => {
    ready([{ ...baseBudget, limitAmount: 0, remaining: -8472, progress: null }]);
    const trigger = button("Remove budget", row());
    trigger.focus();
    click("Remove budget", row());
    await fixture.whenStable();
    expect(document.activeElement).toBe(root.querySelector("#remove-confirmation"));
    expect(root.textContent).toContain("transactions remain unchanged");
    http.expectNone((request) => request.method === "DELETE");
    click("Cancel", row());
    await fixture.whenStable();
    expect(document.activeElement).toBe(trigger);
    click("Remove budget", row());
    click("Confirm removal", row());
    const deletion = http.expectOne((request) => request.method === "DELETE");
    fixture.componentInstance.confirmRemove();
    fixture.componentInstance.cancelRemove();
    fixture.componentInstance.moveMonth(1);
    http.expectNone((request) => request.method === "DELETE" || request.url === "/api/budgets");
    deletion.flush(null, { status: 204, statusText: "No Content" });
    ready();
    await fixture.whenStable();
    expect(row().textContent).toContain("No budget");
    expect(document.activeElement).toBe(button("Set limit", row()));
    expect(root.textContent).toContain("Transactions are unchanged");
  });

  it("focuses the editor and restores its trigger on cancel without changing the selected month", async () => {
    ready();
    const initial = fixture.componentInstance.selectedMonth();
    click("Set limit", row());
    await fixture.whenStable();
    expect(document.activeElement).toBe(root.querySelector("#budget-limit"));
    enter("42");
    fixture.componentInstance.selectMonth("2026-11");
    fixture.componentInstance.retry();
    http.expectNone((request) => request.url === "/api/budgets");
    expect(fixture.componentInstance.selectedMonth()).toBe(initial);
    click("Cancel", row());
    await fixture.whenStable();
    expect(document.activeElement).toBe(button("Set limit", row()));
    http.expectNone((request) => request.method !== "GET");
  });

  it("uses the local default month, January rollover and bounded controls", () => {
    const initial = reads();
    const local = localToday();
    expect(initial.budgets.request.params.get("year")).toBe(String(Number(local.slice(0, 4))));
    expect(initial.budgets.request.params.get("month")).toBe(String(Number(local.slice(5, 7))));
    initial.categories.flush(categories);
    initial.budgets.flush([]);
    fixture.componentInstance.selectMonth("2026-01");
    ready();
    click("Previous month");
    expect(fixture.componentInstance.selectedMonth()).toBe("2025-12");
    ready();
    fixture.componentInstance.selectMonth("0001-01");
    ready();
    expect(button("Previous month").disabled).toBe(true);
    expect(button("Copy previous month").disabled).toBe(true);
    fixture.componentInstance.copyPrevious();
    fixture.componentInstance.moveMonth(-1);
    http.expectNone((request) => request.url.startsWith("/api/budgets"));
    fixture.componentInstance.selectMonth("9999-12");
    ready();
    expect(button("Next month").disabled).toBe(true);
    fixture.componentInstance.moveMonth(1);
    fixture.componentInstance.selectMonth("0000-01");
    fixture.detectChanges();
    expect(root.querySelector('[type="month"]')!.getAttribute("aria-invalid")).toBe("true");
    expect(fixture.componentInstance.selectedMonth()).toBe("9999-12");
    http.expectNone((request) => request.url === "/api/budgets");
  });

  it("cancels older reads and never displays old cards while loading or after either read fails", () => {
    ready([baseBudget]);
    fixture.componentInstance.selectMonth("2026-10");
    const october = reads();
    fixture.detectChanges();
    expect(root.querySelector("li")).toBeNull();
    expect(root.textContent).toContain("Loading budgets");
    fixture.componentInstance.selectMonth("2026-11");
    const november = reads();
    expect(october.categories.cancelled).toBe(true);
    expect(october.budgets.cancelled).toBe(true);
    november.budgets.flush([]);
    november.categories.flush(null, { status: 503, statusText: "Unavailable" });
    fixture.detectChanges();
    expect(root.querySelector("li")).toBeNull();
    expect(root.textContent).not.toContain("No expense categories");
    expect(root.textContent).not.toContain("No budget");
    click("Retry");
    const retry = reads();
    retry.categories.flush(categories);
    retry.budgets.flush(null, { status: 503, statusText: "Unavailable" });
    fixture.detectChanges();
    expect(root.querySelector("li")).toBeNull();
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    click("Retry");
    ready();
    expect(row().textContent).toContain("No budget");
  });
});
