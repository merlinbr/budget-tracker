import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";

import { Budget } from "../../core/api/models";
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

  it("renders exact over-budget usage and percentages above 100 without another request", () => {
    const overBudget: Budget = {
      categoryId: 3, categoryName: "Groceries", isArchived: false, year: 2026, month: 9,
      limitAmount: 8000, spent: 8472, remaining: -472, progress: 1.059,
    };
    dashboardRequest().flush({ ...emptyResponse(2026, 9), budgets: [overBudget] });
    fixture.detectChanges();
    const overview = fixture.nativeElement.querySelector('[aria-label="Budget overview"]') as HTMLElement;
    expect(overview.textContent).toContain("Groceries");
    expect(overview.textContent).toContain("84,72");
    expect(overview.textContent).toContain("80,00");
    expect(overview.textContent).toContain("4,72");
    expect(overview.textContent).toContain("105,9");
    expect(overview.textContent).toContain("Over budget");
    http.expectNone((request) => request.url === "/api/budgets");
  });

  it("shows zero limits with exact overage or no spending and retains archived unused budgets", () => {
    const zeroBudget: Budget = {
      categoryId: 3, categoryName: "Groceries", isArchived: false, year: 2026, month: 9,
      limitAmount: 0, spent: 8472, remaining: -8472, progress: null,
    };
    dashboardRequest().flush({
      ...emptyResponse(2026, 9),
      budgets: [
        zeroBudget,
        { ...zeroBudget, categoryId: 4, categoryName: "Transport", spent: 0, remaining: 0 },
        { ...zeroBudget, categoryId: 5, categoryName: "Old hobbies", isArchived: true, limitAmount: 12000, spent: 0, remaining: 12000, progress: 0 },
      ],
    });
    fixture.detectChanges();
    const overview = fixture.nativeElement.querySelector('[aria-label="Budget overview"]') as HTMLElement;
    const cards = overview.querySelectorAll("li");
    expect(cards[0].textContent).toContain("84,72");
    expect(cards[0].textContent).toContain("0,00");
    expect(cards[0].textContent).toContain("Over budget");
    expect(cards[0].textContent).not.toMatch(/%|NaN|Infinity/);
    expect(cards[1].textContent).toContain("Zero budget — no spending");
    expect(cards[1].textContent).not.toContain("%");
    expect(cards[2].textContent).toContain("Old hobbies");
    expect(cards[2].textContent).toContain("Archived category");
    expect(cards[2].textContent).toContain("120,00");
    expect(cards[2].textContent).toMatch(/0\s*%/);
  });

  it("distinguishes an exact limit from a rounded percentage and a missing overview", () => {
    const atBudget: Budget = {
      categoryId: 3, categoryName: "Groceries", isArchived: false, year: 2026, month: 9,
      limitAmount: 60000, spent: 60000, remaining: 0, progress: 1,
    };
    dashboardRequest().flush({ ...emptyResponse(2026, 9), budgets: [
      atBudget,
      { ...atBudget, categoryId: 4, categoryName: "Near limit", spent: 59999, remaining: 1, progress: 59999 / 60000 },
    ] });
    fixture.detectChanges();
    const cards = fixture.nativeElement.querySelectorAll('[aria-label="Budget overview"] li') as NodeListOf<HTMLLIElement>;
    expect(cards[0].textContent).toContain("At budget");
    expect(cards[1].textContent).toContain("Remaining 0,01");
    expect(cards[1].textContent).not.toContain("At budget");
    fixture.componentInstance.selectMonth("2026-10");
    dashboardRequest().flush(emptyResponse(2026, 10));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("No budgets for this month.");
    expect(fixture.nativeElement.querySelector('[aria-label="Budget overview"]')).toBeNull();
  });
});