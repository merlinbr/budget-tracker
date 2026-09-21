import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpErrorResponse } from "@angular/common/http";
import { HttpResponse } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";

import { Account, Category, HouseholdDetails } from "../../core/api/models";
import { authInterceptor } from "../../core/auth/auth.interceptor";
import { AuthService } from "../../core/auth/auth.service";
import { PendingFormService } from "../../core/pending-form.service";
import { LoginPage } from "../login/login.page";
import { SettingsPage } from "./settings.page";
import { vi } from "vitest";

const authState = {
  user: { id: 1, username: "merlin", displayName: "Merlin" },
  household: { id: 10, name: "Family" },
};
const householdDetails: HouseholdDetails = {
  id: 10,
  name: "Family",
  members: [
    { id: 1, displayName: "Merlin", role: "owner", isActive: true },
    { id: 2, displayName: "Sibling", role: "member", isActive: false },
  ],
};
const accounts: Account[] = [
  { id: 3, name: "Checking", type: "checking", initialBalance: 0, balance: 0, isArchived: false },
  { id: 4, name: "Old card", type: "credit_card", initialBalance: 0, balance: 0, isArchived: true },
];
const categories: Category[] = [
  { id: 5, name: "Food", type: "expense", isArchived: false },
  { id: 6, name: "Old food", type: "expense", isArchived: true },
];

describe("SettingsPage", () => {
  let fixture: ComponentFixture<SettingsPage>;
  let http: HttpTestingController;
  let router: Router;
  let pendingForms: PendingFormService;
  let root: HTMLElement;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [
        provideRouter([{ path: "login", component: LoginPage }]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
    router = TestBed.inject(Router);
    pendingForms = TestBed.inject(PendingFormService);
    pendingForms.setPending(false);
    http = TestBed.inject(HttpTestingController);
    // Sign in after module config, before mounting: page reads identity at construction.
    const auth = TestBed.inject(AuthService);
    auth.restore().subscribe();
    http.expectOne("/api/auth/me").flush(authState);
    fixture = TestBed.createComponent(SettingsPage);
    root = fixture.nativeElement;
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function readyHousehold(): void {
    http.expectOne("/api/household").flush(householdDetails);
    const accountsRequest = http.expectOne((r) => r.url === "/api/accounts");
    const categoriesRequest = http.expectOne((r) => r.url === "/api/categories");
    expect(accountsRequest.request.params.get("includeArchived")).toBe("true");
    accountsRequest.flush(accounts);
    categoriesRequest.flush(categories);
    fixture.detectChanges();
  }

  function button(label: string, scope: HTMLElement = root): HTMLButtonElement {
    const match = [...scope.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
    if (!match) throw new Error(`Missing button ${label}`);
    return match;
  }

  function input(selector: string): HTMLInputElement {
    const match = root.querySelector<HTMLInputElement>(selector);
    if (!match) throw new Error(`Missing input ${selector}`);
    return match;
  }

  function type(selector: string, value: string): void {
    const element = input(selector);
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    fixture.detectChanges();
  }

  it("shows profile and read-only username, household members sorted with inactive label, and archived selector options", () => {
    readyHousehold();
    expect(input("#settings-username").value).toBe("merlin");
    expect(input("#settings-username").readOnly).toBeTruthy();
    expect(root.textContent).toContain("Sibling");
    expect(root.textContent).toContain("Inactive");
    const select = root.querySelector<HTMLSelectElement>("#export-account")!;
    expect(select.textContent!.replace(/\s+/g, " ")).toContain("Old card (archived");
  });

  it("saves the display name, updates the auth state and matching member row without re-login", () => {
    readyHousehold();
    type("#settings-display-name", "  Merlin Renamed  ");
    button("Save profile").click();
    const request = http.expectOne((r) => r.url === "/api/users/me" && r.method === "PATCH");
    expect(request.request.body).toEqual({ displayName: "Merlin Renamed" });
    request.flush({ id: 1, username: "merlin", displayName: "Merlin Renamed" });
    fixture.detectChanges();
    expect(TestBed.inject(AuthService).authState()?.user.displayName).toBe("Merlin Renamed");
    expect(root.textContent).toContain("Merlin Renamed");
    // No revocation: identity survives.
    expect(TestBed.inject(AuthService).restoration()).toBe("ready");
  });

  it("announces profile persistence and resets the announcement for the next attempt", () => {
    readyHousehold();
    type("#settings-display-name", "Merlin Renamed");
    button("Save profile").click();
    http.expectOne((r) => r.method === "PATCH").flush({
      id: 1,
      username: "merlin",
      displayName: "Merlin Renamed",
    });
    fixture.detectChanges();
    const status = root.querySelector<HTMLElement>("#profile-status")!;
    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent).toContain("Profile saved.");

    button("Save profile").click();
    fixture.detectChanges();
    expect(root.textContent).not.toContain("Profile saved.");
    http.expectOne((r) => r.method === "PATCH").flush(
      { error: { code: "VALIDATION_ERROR", message: "The request could not be processed." } },
      { status: 422, statusText: "Unprocessable Entity" },
    );
    fixture.detectChanges();
    expect(root.textContent).toContain("The request could not be processed.");
  });

  it("blocks duplicate saves while pending and releases the guard on completion", () => {
    readyHousehold();
    type("#settings-display-name", "New name");
    button("Save profile").click();
    fixture.detectChanges();
    expect(pendingForms.pending()).toBeTruthy();
    // Label switches to "Saving…" while pending; assert the same element is disabled.
    const saveButton = [...root.querySelectorAll<HTMLButtonElement>("#profile-form button[type=submit]")][0];
    expect(saveButton.disabled).toBeTruthy();
    const request = http.expectOne((r) => r.method === "PATCH");
    request.flush({ id: 1, username: "merlin", displayName: "New name" });
    fixture.detectChanges();
    expect(pendingForms.pending()).toBeFalsy();
    expect(saveButton.disabled).toBeFalsy();
  });

  it("keeps profile input and shows server error on failure", () => {
    readyHousehold();
    type("#settings-display-name", "Keep me");
    button("Save profile").click();
    const request = http.expectOne((r) => r.method === "PATCH");
    request.flush(
      { error: { code: "VALIDATION_ERROR", message: "The request could not be processed." } },
      { status: 422, statusText: "Unprocessable Entity" },
    );
    fixture.detectChanges();
    expect(input("#settings-display-name").value).toBe("Keep me");
    expect(root.textContent).toContain("The request could not be processed.");
  });

  it("does not send a change when the confirmation does not match", () => {
    readyHousehold();
    type("#settings-current-password", "current password 1");
    type("#settings-new-password", "new password 12");
    type("#settings-confirm-password", "different password 1");
    button("Change password").click();
    fixture.detectChanges();
    http.expectNone((r) => r.url === "/api/auth/change-password");
    expect(root.textContent!.toLowerCase()).toContain("do not match");
  });

  it("identifies local current and new password errors with field associations", () => {
    readyHousehold();
    type("#settings-current-password", "");
    type("#settings-new-password", "short");
    type("#settings-confirm-password", "short");
    button("Change password").click();
    fixture.detectChanges();
    http.expectNone((r) => r.url === "/api/auth/change-password");
    const current = input("#settings-current-password");
    const next = input("#settings-new-password");
    expect(current.getAttribute("aria-invalid")).toBe("true");
    expect(next.getAttribute("aria-invalid")).toBe("true");
    expect(current.getAttribute("aria-describedby")).toContain("current-password-error");
    expect(next.getAttribute("aria-describedby")).toContain("new-password-error");
    expect(root.querySelector("#current-password-error")!.textContent).toContain("at least 12 characters");
    expect(root.querySelector("#new-password-error")!.textContent).toContain("12 to 1024 characters");
  });

  it("sends the password change and navigates to login with the one-time notice on 204", async () => {
    readyHousehold();
    type("#settings-current-password", "current password 1");
    type("#settings-new-password", "new password 12");
    type("#settings-confirm-password", "new password 12");
    button("Change password").click();
    const request = http.expectOne((r) => r.url === "/api/auth/change-password" && r.method === "POST");
    request.flush(null);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(TestBed.inject(AuthService).authState()).toBeNull();
    // Navigated to the exact login path (jsdom history.state is not observable
    // here; the notice consumer contract is covered by the Login spec).
    expect(router.url).toBe("/login");
  });

  it("shows the current-password field error on 422 without clearing auth or replaying", () => {
    readyHousehold();
    type("#settings-current-password", "wrong password 123");
    type("#settings-new-password", "new password 12");
    type("#settings-confirm-password", "new password 12");
    button("Change password").click();
    const request = http.expectOne((r) => r.url === "/api/auth/change-password");
    request.flush(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "The request could not be processed.",
          fields: { currentPassword: "Current password is incorrect." },
        },
      },
      { status: 422, statusText: "Unprocessable Entity" },
    );
    fixture.detectChanges();
    expect(root.textContent).toContain("Current password is incorrect.");
    expect(TestBed.inject(AuthService).authState()).toEqual(authState);
  });

  it("hydrates household load failure separately from identity and allows GET retry", () => {
    http.expectOne("/api/household").flush(
      { error: { code: "INTERNAL_ERROR", message: "Unexpected error." } },
      { status: 500, statusText: "Server Error" },
    );
    // Wait: household read runs at construction; selectors were requested too.
    http.expectOne((r) => r.url === "/api/accounts").flush(accounts);
    http.expectOne((r) => r.url === "/api/categories").flush(categories);
    fixture.detectChanges();
    expect(root.textContent).toContain("Could not load household details.");
    expect(input("#settings-username").value).toBe("merlin");
    button("Retry").click();
    http.expectOne("/api/household").flush(householdDetails);
    fixture.detectChanges();
    expect(root.textContent).toContain(householdDetails.name);
  });

  it("selector failure still leaves date-only export usable with date inputs visible", () => {
    http.expectOne("/api/household").flush(householdDetails);
    const accountsRequest = http.expectOne((r) => r.url === "/api/accounts");
    accountsRequest.flush(
      { error: { code: "CONFLICT", message: "The calculated amount exceeds the supported range." } },
      { status: 409, statusText: "Conflict" },
    );
    http.expectOne((r) => r.url === "/api/categories").flush(categories);
    fixture.detectChanges();
    expect(root.textContent).toContain("Could not load account and category filters.");
    const fromDate = input("#export-from");
    expect(fromDate).toBeTruthy();
    const dataCard = [...root.querySelectorAll("section")].find((el) =>
      el.textContent?.includes("Download this household's transactions"),
    )!;
    expect(button("Retry", dataCard).disabled).toBeFalsy();
    expect(button("Download CSV").disabled).toBeFalsy();
    fromDate.value = "2026-09-01";
    fromDate.dispatchEvent(new Event("change", { bubbles: true }));
    fixture.detectChanges();
    button("Download CSV").click();
    const exportRequest = http.expectOne((r) => r.url === "/api/export/transactions.csv");
    expect(exportRequest.request.params.get("from")).toBe("2026-09-01");
    expect(exportRequest.request.params.get("accountId")).toBeNull();
    exportRequest.flush(new Blob(["date,description\r\n"], { type: "text/csv" }));
    fixture.detectChanges();
    expect(root.textContent).toContain("Download started.");
  });

  it("prunes a selected account id that disappears from a refreshed selector list", () => {
    readyHousehold();
    const accountSelect = root.querySelector<HTMLSelectElement>("#export-account")!;
    accountSelect.value = "3";
    accountSelect.dispatchEvent(new Event("change", { bubbles: true }));
    fixture.detectChanges();
    // Refresh selectors without the previously selected account (id 3).
    fixture.componentInstance.retrySelectors();
    http.expectOne((r) => r.url === "/api/accounts").flush([accounts[1]]);
    http.expectOne((r) => r.url === "/api/categories").flush(categories);
    fixture.detectChanges();
    button("Download CSV").click();
    const exportRequest = http.expectOne((r) => r.url === "/api/export/transactions.csv");
    expect(exportRequest.request.params.get("accountId")).toBeNull();
    exportRequest.flush(new Blob(["date,description\r\n"], { type: "text/csv" }));
    fixture.detectChanges();
    expect(root.textContent).toContain("Download started.");
  });

  it("allows unfiltered export while selector requests are loading", () => {
    expect(input("#export-from")).toBeTruthy();
    button("Download CSV").click();
    const exportRequest = http.expectOne((r) => r.url === "/api/export/transactions.csv");
    expect(exportRequest.request.params.get("from")).toBeNull();
    expect(exportRequest.request.params.get("accountId")).toBeNull();
    expect(exportRequest.request.params.get("categoryId")).toBeNull();
    exportRequest.flush(new Blob(["date,description\r\n"], { type: "text/csv" }));
    http.expectOne("/api/household").flush(householdDetails);
    http.expectOne((r) => r.url === "/api/accounts").flush(accounts);
    http.expectOne((r) => r.url === "/api/categories").flush(categories);
    fixture.detectChanges();
    expect(root.textContent).toContain("Download started.");
  });

  it("filters export params from selected values", () => {
    readyHousehold();
    type("#export-from", "");
    const fromDate = input("#export-from");
    fromDate.value = "2026-09-01";
    fromDate.dispatchEvent(new Event("change", { bubbles: true }));
    const accountSelect = root.querySelector<HTMLSelectElement>("#export-account")!;
    accountSelect.value = "3";
    accountSelect.dispatchEvent(new Event("change", { bubbles: true }));
    fixture.detectChanges();
    button("Download CSV").click();
    const request = http.expectOne((r) => r.url === "/api/export/transactions.csv");
    expect(request.request.params.get("from")).toBe("2026-09-01");
    expect(request.request.params.get("to")).toBeNull();
    expect(request.request.params.get("accountId")).toBe("3");
    request.flush(new Blob(["data\r\n"], { type: "text/csv" }));
    fixture.detectChanges();
    expect(root.textContent).toContain("Download started.");
  });

  it("rejects a reversed date range before the download request", () => {
    readyHousehold();
    const fromDate = input("#export-from");
    fromDate.value = "2026-09-10";
    fromDate.dispatchEvent(new Event("change", { bubbles: true }));
    const toDate = input("#export-to");
    toDate.value = "2026-09-01";
    toDate.dispatchEvent(new Event("change", { bubbles: true }));
    fixture.detectChanges();
    button("Download CSV").click();
    http.expectNone((r) => r.url === "/api/export/transactions.csv");
    fixture.detectChanges();
    expect(root.textContent).toContain("from date must be on or before");
  });

  it("decodes a JSON error Blob into message and field feedback without downloading", async () => {
    readyHousehold();
    button("Download CSV").click();
    const request = http.expectOne((r) => r.url === "/api/export/transactions.csv");
    request.flush(
      new Blob([JSON.stringify({
        error: {
          code: "VALIDATION_ERROR",
          message: "The request could not be processed.",
          fields: {
            from: "Year must be between 1900 and 2100.",
            to: "Choose a valid end date.",
            accountId: "That account is not available.",
            categoryId: "That category is not available.",
          },
        },
      })], { type: "application/json" }),
      { status: 422, statusText: "Unprocessable Entity" },
    );
    fixture.detectChanges();
    expect(root.querySelector<HTMLButtonElement>("#download-csv")!.disabled).toBeTruthy();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(root.textContent).toContain("The request could not be processed.");
      expect(root.textContent).toContain("Year must be between 1900 and 2100.");
      expect(root.textContent).toContain("Choose a valid end date.");
      expect(root.textContent).toContain("That account is not available.");
      expect(root.textContent).toContain("That category is not available.");
      expect(root.textContent).not.toContain("Download started.");
      expect(root.querySelector<HTMLButtonElement>("#download-csv")!.disabled).toBeFalsy();
    });
    expect(input("#export-from").getAttribute("aria-invalid")).toBe("true");
    expect(input("#export-from").getAttribute("aria-describedby")).toContain("export-from-error");
    expect(input("#export-to").getAttribute("aria-invalid")).toBe("true");
    expect(input("#export-to").getAttribute("aria-describedby")).toContain("export-to-error");
    const account = root.querySelector<HTMLSelectElement>("#export-account")!;
    const category = root.querySelector<HTMLSelectElement>("#export-category")!;
    expect(account.getAttribute("aria-invalid")).toBe("true");
    expect(account.getAttribute("aria-describedby")).toContain("export-account-error");
    expect(category.getAttribute("aria-invalid")).toBe("true");
    expect(category.getAttribute("aria-describedby")).toContain("export-category-error");
    expect(root.querySelector("#download-csv")!.getAttribute("aria-describedby")).toContain("export-error");
  });

  it("falls back safely for a malformed export error Blob", async () => {
    readyHousehold();
    button("Download CSV").click();
    const request = http.expectOne((r) => r.url === "/api/export/transactions.csv");
    request.flush(new Blob(["not JSON"], { type: "application/json" }), {
      status: 500,
      statusText: "Server Error",
    });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(root.textContent).toContain("Could not download the CSV.");
      expect(root.textContent).not.toContain("Download started.");
      expect(root.querySelector<HTMLButtonElement>("#download-csv")!.disabled).toBeFalsy();
    });
  });

  it("shows a connection fallback for a network export failure", () => {
    readyHousehold();
    button("Download CSV").click();
    const request = http.expectOne((r) => r.url === "/api/export/transactions.csv");
    request.error(new ProgressEvent("error"), { status: 0, statusText: "Unknown Error" });
    fixture.detectChanges();
    expect(root.textContent).toContain("Could not connect. Check your connection and try again.");
    expect(button("Download CSV").disabled).toBeFalsy();
  });

  it("clears password inputs after successful change before navigating", async () => {
    readyHousehold();
    type("#settings-current-password", "current password 1");
    type("#settings-new-password", "new password 12");
    type("#settings-confirm-password", "new password 12");
    button("Change password").click();
    const request = http.expectOne((r) => r.url === "/api/auth/change-password");
    request.flush(null);
    await fixture.whenStable();
    // Password form state was cleared before leaving the page.
    expect(input("#settings-current-password").value).toBe("");
  });
});
