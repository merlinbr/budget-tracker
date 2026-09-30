import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { Component } from "@angular/core";
import { provideRouter } from "@angular/router";
import { provideHttpClientTesting, HttpTestingController } from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";

import { AuthService } from "../../core/auth/auth.service";
import { authInterceptor } from "../../core/auth/auth.interceptor";
import { PendingFormService } from "../../core/pending-form.service";
import { AccountsPage } from "./accounts.page";

const row = { id: 1, name: "Main", type: "checking" as const, initialBalance: 0, balance: 0, isArchived: false };

@Component({ standalone: true, template: "" })
class DestinationPage {}

describe("AccountsPage", () => {
  let fixture: ComponentFixture<AccountsPage>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountsPage],
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([{ path: "login", component: DestinationPage }]),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AccountsPage);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne((request) => request.url === "/api/accounts" && request.params.get("includeArchived") === "false").flush([]);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it("cancels account list and detail GETs on destruction", () => {
    fixture.componentInstance.loadList();
    const list = http.expectOne((r) => r.url === "/api/accounts");
    fixture.componentInstance.startEdit(row);
    const detail = http.expectOne("/api/accounts/1");
    fixture.destroy();
    expect(list.cancelled).toBe(true);
    expect(detail.cancelled).toBe(true);
  });

  it("keeps the newer account detail when the old response arrives last", () => {
    const newer = { ...row, id: 2, name: "Newer account" };
    fixture.componentInstance.startEdit(row);
    const oldRequest = http.expectOne("/api/accounts/1");
    fixture.componentInstance.startEdit(newer);
    const newRequest = http.expectOne("/api/accounts/2");
    newRequest.flush(newer);
    oldRequest.flush(row);
    expect(fixture.componentInstance.editingAccount()?.id).toBe(2);
    expect(fixture.componentInstance.form.controls.name.value).toBe("Newer account");
  });

  it("cancels an abandoned account GET before it can clear a newer login", () => {
    const auth = TestBed.inject(AuthService);
    const identity = {
      user: { id: 1, username: "user", displayName: "User" },
      household: { id: 10, name: "Household" },
    };
    const login = () => {
      auth.login("user", "correct horse battery staple").subscribe();
      http.expectOne("/api/auth/csrf").flush(null);
      http.expectOne("/api/auth/login").flush(identity);
    };
    login();
    fixture.componentInstance.loadList();
    const abandoned = http.expectOne((r) => r.url === "/api/accounts");
    fixture.destroy();

    auth.logout().subscribe();
    http.expectOne("/api/auth/csrf").flush(null);
    http.expectOne("/api/auth/logout").flush(null);
    login();
    // Deliver the real interceptor error only while the request is still live.
    if (!abandoned.cancelled) {
      abandoned.flush(null, { status: 401, statusText: "Unauthorized" });
    }
    expect(auth.authState()).toEqual(identity);
    expect(abandoned.cancelled).toBe(true);
  });

  it.each([
    ["create", 200], ["create", 422], ["archive", 200], ["archive", 422],
  ] as const)("releases abandoned %s on %s without cancelling it", (action, status) => {
    const page = fixture.componentInstance;
    if (action === "create") {
      page.startAdd();
      page.form.controls.name.setValue("Pending");
      page.save();
    } else {
      page.beginArchive(row);
      page.confirmArchive();
    }
    const write = http.expectOne({ method: "POST", url: action === "create" ? "/api/accounts" : "/api/accounts/1/archive" });
    const pending = TestBed.inject(PendingFormService);
    expect(pending.pending()).toBe(true);
    fixture.destroy();
    expect(write.cancelled).toBe(false);
    expect(pending.pending()).toBe(false);
    if (status === 200) write.flush(action === "create" ? { ...row, name: "Pending" } : null);
    else write.flush(null, { status: 422, statusText: "Unprocessable Entity" });
    expect(pending.pending()).toBe(false);
    expect(page.announcement()).toBeNull();
    expect(page.saveError()).toBeNull();
    http.expectNone((r) => r.method === "GET");
  });

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
