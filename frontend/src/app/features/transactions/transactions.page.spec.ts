import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting, HttpTestingController } from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";

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

  function flushLookups(): void {
    http.expectOne((request) => request.url === "/api/accounts" && request.params.get("includeArchived") === "true").flush([]);
    http.expectOne((request) => request.url === "/api/categories" && request.params.get("includeArchived") === "true").flush([]);
  }

  function initialTransactions() {
    return http.expectOne((request) => request.url === "/api/transactions");
  }

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
