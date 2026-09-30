import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting, HttpTestingController } from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";

import { PendingFormService } from "../../core/pending-form.service";
import { localToday } from "../../shared/utilities/money";
import { TransactionsPage } from "./transactions.page";

describe("TransactionsPage", () => {
  let fixture: ComponentFixture<TransactionsPage>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TransactionsPage], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(TransactionsPage);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it.each([
    ["create", 200], ["create", 422], ["delete", 200], ["delete", 422],
  ] as const)("releases abandoned %s on %s without cancelling it", (action, status) => {
    flushLookups();
    initialTransactions().flush([]);
    const transaction = {
      id: 1, accountId: 1, categoryId: 1, amount: -100, description: "Pending",
      transactionDate: "2026-09-07",
      createdAt: "2026-09-07T00:00:00Z", updatedAt: "2026-09-07T00:00:00Z",
    };
    const page = fixture.componentInstance;
    if (action === "create") {
      page.save({ accountId: 1, categoryId: 1, amount: -100, description: "Pending", transactionDate: "2026-09-07" });
    } else {
      page.beginDelete(transaction);
      page.confirmDelete();
    }
    const write = http.expectOne({ method: action === "create" ? "POST" : "DELETE", url: action === "create" ? "/api/transactions" : "/api/transactions/1" });
    const pending = TestBed.inject(PendingFormService);
    expect(pending.pending()).toBe(true);
    fixture.destroy();
    expect(write.cancelled).toBe(false);
    expect(pending.pending()).toBe(false);
    if (status === 200) write.flush(action === "create" ? transaction : null);
    else write.flush(null, { status: 422, statusText: "Unprocessable Entity" });
    expect(pending.pending()).toBe(false);
    expect(page.announcement()).toBeNull();
    expect(page.saveError()).toBeNull();
    http.expectNone((r) => r.method === "GET");
  });

  function flushLookups(): void {
    http.expectOne((request) => request.url === "/api/accounts" && request.params.get("includeArchived") === "true").flush([]);
    http.expectOne((request) => request.url === "/api/categories" && request.params.get("includeArchived") === "true").flush([]);
  }

  function initialTransactions() {
    return http.expectOne((request) => request.url === "/api/transactions");
  }

  it("cancels lookup, detail and filtered-list GETs on destruction", () => {
    const accounts = http.expectOne((r) => r.url === "/api/accounts");
    const categories = http.expectOne((r) => r.url === "/api/categories");
    const list = initialTransactions();
    const transaction = {
      id: 1, accountId: 1, categoryId: 1, amount: -100, description: "Pending",
      transactionDate: "2026-09-07",
      createdAt: "2026-09-07T00:00:00Z", updatedAt: "2026-09-07T00:00:00Z",
    };
    fixture.componentInstance.startEdit(transaction);
    const detail = http.expectOne("/api/transactions/1");
    fixture.destroy();
    expect(list.cancelled).toBe(true);
    expect(accounts.cancelled).toBe(true);
    expect(categories.cancelled).toBe(true);
    expect(detail.cancelled).toBe(true);
  });

  it("keeps the newer transaction detail when the old response arrives last", () => {
    flushLookups();
    initialTransactions().flush([]);
    const older = {
      id: 1, accountId: 1, categoryId: 1, amount: -100, description: "Older",
      transactionDate: "2026-09-07",
      createdAt: "2026-09-07T00:00:00Z", updatedAt: "2026-09-07T00:00:00Z",
    };
    const newer = { ...older, id: 2, description: "Newer" };
    fixture.componentInstance.startEdit(older);
    const oldRequest = http.expectOne("/api/transactions/1");
    fixture.componentInstance.startEdit(newer);
    const newRequest = http.expectOne("/api/transactions/2");
    newRequest.flush(newer);
    oldRequest.flush(older);
    expect(fixture.componentInstance.editingTransaction()?.id).toBe(2);
  });

  it("loads archived labels and the exact local current month", () => {
    flushLookups();
    const request = initialTransactions();
    const month = localToday().slice(0, 7);
    expect(request.request.params.get("year")).toBe(month.slice(0, 4));
    expect(request.request.params.get("month")).toBe(String(Number(month.slice(5, 7))));
    request.flush([]);
    fixture.detectChanges();
    expect(fixture.componentInstance.listReady()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain("No transactions match these filters.");
  });

  it("applies filters and clears them without losing request state", () => {
    flushLookups();
    initialTransactions().flush([]);
    fixture.componentInstance.filterForm.setValue({ month: "2025-01", accountId: 4, categoryId: 8, type: "expense", search: "food" });
    fixture.componentInstance.applyFilters();
    const filtered = initialTransactions();
    expect(filtered.request.params.get("year")).toBe("2025");
    expect(filtered.request.params.get("month")).toBe("1");
    expect(filtered.request.params.get("accountId")).toBe("4");
    expect(filtered.request.params.get("categoryId")).toBe("8");
    expect(filtered.request.params.get("type")).toBe("expense");
    expect(filtered.request.params.get("search")).toBe("food");
    filtered.flush([]);
    fixture.componentInstance.clearFilters();
    const cleared = initialTransactions();
    expect(cleared.request.params.has("year")).toBe(false);
    expect(cleared.request.params.has("month")).toBe(false);
    expect(cleared.request.params.has("accountId")).toBe(false);
    expect(cleared.request.params.has("search")).toBe(false);
    cleared.flush([]);
  });

  it("ignores a stale filter response when a newer request wins", () => {
    flushLookups();
    initialTransactions().flush([]);
    fixture.componentInstance.filterForm.controls.month.setValue("2025-01");
    fixture.componentInstance.applyFilters();
    const oldRequest = initialTransactions();
    fixture.componentInstance.filterForm.controls.month.setValue("2025-02");
    fixture.componentInstance.applyFilters();
    const newRequest = initialTransactions();
    expect(oldRequest.cancelled).toBe(true);
    expect(fixture.componentInstance.listLoading()).toBe(true);
    newRequest.flush([{ id: 2, accountId: 1, categoryId: 1, amount: 100, description: "new", transactionDate: "2025-02-02", createdAt: "2025-02-02T00:00:00Z", updatedAt: "2025-02-02T00:00:00Z" }]);
    expect(fixture.componentInstance.transactions().map((row) => row.id)).toEqual([2]);
  });

  it("distinguishes list failure from empty results and recovers on retry", () => {
    flushLookups();
    initialTransactions().flush({ error: { message: "down" } }, { status: 500, statusText: "Server Error" });
    fixture.detectChanges();
    expect(fixture.componentInstance.listError()).toBe("down");
    expect(fixture.nativeElement.textContent).not.toContain("No transactions match these filters.");
    fixture.componentInstance.retry();
    const retry = initialTransactions();
    retry.flush([]);
    fixture.detectChanges();
    expect(fixture.componentInstance.listError()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain("No transactions match these filters.");
  });
});
