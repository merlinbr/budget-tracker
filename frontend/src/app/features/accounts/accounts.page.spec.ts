import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting, HttpTestingController } from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";

import { AccountsPage } from "./accounts.page";

const row = { id: 1, name: "Main", type: "checking" as const, initialBalance: 0, balance: 0, isArchived: false };

describe("AccountsPage", () => {
  let fixture: ComponentFixture<AccountsPage>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AccountsPage], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(AccountsPage);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne((request) => request.url === "/api/accounts" && request.params.get("includeArchived") === "false").flush([]);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it("submits a negative comma balance from a native form", () => {
    fixture.componentInstance.startAdd();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    (element.querySelector("#account-name") as HTMLInputElement).value = "Card";
    element.querySelector("#account-name")!.dispatchEvent(new Event("input", { bubbles: true }));
    (element.querySelector("#account-type") as HTMLSelectElement).value = "credit_card";
    element.querySelector("#account-type")!.dispatchEvent(new Event("change", { bubbles: true }));
    (element.querySelector("#initial-balance") as HTMLInputElement).value = "-84,72";
    element.querySelector("#initial-balance")!.dispatchEvent(new Event("input", { bubbles: true }));
    element.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    const request = http.expectOne({ method: "POST", url: "/api/accounts" });
    expect(request.request.body).toEqual({ name: "Card", type: "credit_card", initialBalance: -8472 });
    request.flush({ ...row, name: "Card", type: "credit_card", initialBalance: -8472, balance: -8472 });
    http.expectOne((r) => r.url === "/api/accounts").flush([]);
  });

  it("does not write invalid or overflowing balances", () => {
    fixture.componentInstance.startAdd();
    fixture.componentInstance.form.controls.name.setValue("Card");
    fixture.componentInstance.form.controls.initialBalance.setValue("90071992547409.92");
    fixture.componentInstance.save();
    expect(http.match({ method: "POST", url: "/api/accounts" })).toHaveLength(0);
    expect(fixture.componentInstance.form.controls.initialBalance.invalid).toBe(true);
  });

  it("requires acknowledgement before a changed initial balance", () => {
    fixture.componentInstance.startEdit(row);
    const detail = http.expectOne({ method: "GET", url: "/api/accounts/1" });
    detail.flush(row);
    fixture.detectChanges();
    fixture.componentInstance.form.controls.initialBalance.setValue("1.00");
    fixture.componentInstance.save();
    expect(http.match({ method: "PUT", url: "/api/accounts/1" })).toHaveLength(0);
    expect(fixture.componentInstance.form.controls.acknowledgeBalanceChange.hasError("required")).toBe(true);
  });

  it("preserves values and associates a conflict with the name", () => {
    fixture.componentInstance.startAdd();
    fixture.componentInstance.form.setValue({ name: "Card", type: "credit_card", initialBalance: "-84,72", acknowledgeBalanceChange: false });
    fixture.componentInstance.save();
    const request = http.expectOne({ method: "POST", url: "/api/accounts" });
    request.flush({ error: { code: "CONFLICT", message: "Name already used.", fields: { name: "Choose a different name." } } }, { status: 409, statusText: "Conflict" });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect((element.querySelector("#account-name") as HTMLInputElement).value).toBe("Card");
    expect((element.querySelector("#initial-balance") as HTMLInputElement).value).toBe("-84,72");
    expect(element.querySelector("#account-name")?.getAttribute("aria-describedby")).toContain("account-name-error");
    expect(element.querySelector("#account-name-error")?.textContent).toContain("Choose a different name.");
  });
});
