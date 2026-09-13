import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";

import { localToday } from "../../shared/utilities/money";
import { DashboardPage } from "./dashboard.page";

function emptyResponse(year: number, month: number) {
  return {
    period: { year, month },
    summary: { balance: 0, income: 0, expenses: 0, net: 0 },
    budgets: [],
    spendingByCategory: [],
    recentTransactions: [],
  };
}

describe("DashboardPage", () => {
  let fixture: ComponentFixture<DashboardPage>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(DashboardPage);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function dashboardRequest() {
    return http.expectOne((request) => request.url === "/api/dashboard");
  }

  it("requests the local current month and renders ready totals", () => {
    const request = dashboardRequest();
    const month = localToday().slice(0, 7);
    expect(request.request.params.get("year")).toBe(month.slice(0, 4));
    expect(request.request.params.get("month")).toBe(String(Number(month.slice(5, 7))));
    request.flush({
      period: { year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) },
      summary: { balance: 439729, income: 350000, expenses: 8472, net: 341528 },
      budgets: [],
      spendingByCategory: [{ categoryId: 3, categoryName: "Groceries", spent: 8472 }],
      recentTransactions: [
        {
          id: 1, accountId: 1, accountName: "Checking", categoryId: 3,
          categoryName: "Groceries", amount: -8472, description: "REWE",
          transactionDate: "2026-09-07",
        },
      ],
    });
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain("4.397,29");
    expect(text).toContain("3.500,00");
    expect(text).toContain("84,72");
    expect(text).toContain("Groceries");
    expect(text).toContain("2026-09-07");
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
  });

  it("does not show old totals under a new month or treat failure as empty", () => {
    const first = dashboardRequest();
    const year = Number(first.request.params.get("year"));
    const month = Number(first.request.params.get("month"));
    first.flush({
      period: { year, month },
      summary: { balance: 10000, income: 12345, expenses: 0, net: 12345 },
      budgets: [], spendingByCategory: [], recentTransactions: [],
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("123,45");

    fixture.componentInstance.selectMonth("2026-10");
    const october = http.expectOne((request) => request.params.get("month") === "10");
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain("123,45");
    october.flush({ error: { message: "Unavailable" } }, { status: 503, statusText: "Unavailable" });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain("No transactions this month.");

    fixture.componentInstance.retry();
    http
      .expectOne((request) => request.params.get("year") === "2026" && request.params.get("month") === "10")
      .flush({
        period: { year: 2026, month: 10 },
        summary: { balance: 10000, income: 0, expenses: 0, net: 0 },
        budgets: [], spendingByCategory: [], recentTransactions: [],
      });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain("No transactions this month.");
  });

  it("rolls over December to January and disables the year endpoints", () => {
    dashboardRequest().flush(emptyResponse(2026, 9));
    fixture.componentInstance.selectMonth("2026-12");
    dashboardRequest().flush(emptyResponse(2026, 12));
    fixture.componentInstance.moveMonth(1);
    expect(fixture.componentInstance.selectedMonth()).toBe("2027-01");
    dashboardRequest().flush(emptyResponse(2027, 1));

    fixture.componentInstance.selectMonth("0001-01");
    dashboardRequest().flush(emptyResponse(1, 1));
    fixture.detectChanges();
    const previous = fixture.nativeElement.querySelector("button") as HTMLButtonElement;
    expect(previous.disabled).toBe(true);

    fixture.componentInstance.selectMonth("9999-12");
    dashboardRequest().flush(emptyResponse(9999, 12));
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll("button") as NodeListOf<HTMLButtonElement>;
    expect(buttons[1].disabled).toBe(true);
  });

  it("rejects invalid input without issuing a request and keeps the last selection", () => {
    const initial = fixture.componentInstance.selectedMonth();
    dashboardRequest().flush(emptyResponse(Number(initial.slice(0, 4)), Number(initial.slice(5, 7))));
    fixture.componentInstance.selectMonth("2026-13");
    http.expectNone((request) => request.url === "/api/dashboard");
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedMonth()).toBe(initial);
    expect(fixture.nativeElement.querySelector("#dashboard-month-error")).not.toBeNull();
    expect(fixture.nativeElement.querySelector("#dashboard-month")?.getAttribute("aria-invalid")).toBe("true");
  });

  it("cancels the earlier request when a newer selection wins", () => {
    dashboardRequest().flush(emptyResponse(2026, 9));
    fixture.componentInstance.selectMonth("2026-10");
    const first = dashboardRequest();
    fixture.componentInstance.selectMonth("2026-11");
    const second = dashboardRequest();
    expect(first.cancelled).toBe(true);
    second.flush(emptyResponse(2026, 11));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("Selected month: 2026-11");
  });

  it("cancels in-flight work on destruction", () => {
    const request = dashboardRequest();
    fixture.destroy();
    expect(request.cancelled).toBe(true);
  });
});