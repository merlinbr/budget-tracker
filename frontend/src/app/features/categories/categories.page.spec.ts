import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting, HttpTestingController } from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";

import { PendingFormService } from "../../core/pending-form.service";
import { CategoriesPage } from "./categories.page";

const row = { id: 1, name: "Groceries", type: "expense" as const, isArchived: false };

describe("CategoriesPage", () => {
  let fixture: ComponentFixture<CategoriesPage>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CategoriesPage], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(CategoriesPage);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne((request) => request.url === "/api/categories" && request.params.get("includeArchived") === "false").flush([]);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it("cancels category list and detail GETs on destruction", () => {
    fixture.componentInstance.loadList();
    const list = http.expectOne((r) => r.url === "/api/categories");
    fixture.componentInstance.startEdit(row);
    const detail = http.expectOne("/api/categories/1");
    fixture.destroy();
    expect(list.cancelled).toBe(true);
    expect(detail.cancelled).toBe(true);
  });

  it("keeps the newer category detail when the old response arrives last", () => {
    const newer = { ...row, id: 2, name: "Newer category" };
    fixture.componentInstance.startEdit(row);
    const oldRequest = http.expectOne("/api/categories/1");
    fixture.componentInstance.startEdit(newer);
    const newRequest = http.expectOne("/api/categories/2");
    newRequest.flush(newer);
    oldRequest.flush(row);
    expect(fixture.componentInstance.editingCategory()?.id).toBe(2);
    expect(fixture.componentInstance.form.controls.name.value).toBe("Newer category");
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
    const write = http.expectOne({ method: "POST", url: action === "create" ? "/api/categories" : "/api/categories/1/archive" });
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

  it.each([{ type: "expense" as const }, { type: "income" as const }])("creates a $type category", ({ type }) => {
    fixture.componentInstance.startAdd();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const name = type === "expense" ? "Groceries" : "Salary";
    (element.querySelector("#category-name") as HTMLInputElement).value = name;
    element.querySelector("#category-name")!.dispatchEvent(new Event("input", { bubbles: true }));
    (element.querySelector("#category-type") as HTMLSelectElement).value = type;
    element.querySelector("#category-type")!.dispatchEvent(new Event("change", { bubbles: true }));
    element.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    const request = http.expectOne({ method: "POST", url: "/api/categories" });
    expect(request.request.body).toEqual({ name: type === "expense" ? "Groceries" : "Salary", type });
    request.flush({ ...row, name: type === "expense" ? "Groceries" : "Salary", type });
    http.expectOne((r) => r.url === "/api/categories").flush([]);
  });

  it("renames an existing category with a name-only payload", () => {
    fixture.componentInstance.startEdit(row);
    http.expectOne({ method: "GET", url: "/api/categories/1" }).flush(row);
    fixture.detectChanges();
    fixture.componentInstance.form.controls.name.setValue("Food");
    fixture.componentInstance.save();
    const request = http.expectOne({ method: "PUT", url: "/api/categories/1" });
    expect(request.request.body).toEqual({ name: "Food" });
    request.flush({ ...row, name: "Food" });
    http.expectOne((r) => r.url === "/api/categories").flush([]);
  });

  it("preserves name and type when save fails", () => {
    fixture.componentInstance.startAdd();
    fixture.componentInstance.form.setValue({ name: "Salary", type: "income" });
    fixture.componentInstance.save();
    const request = http.expectOne({ method: "POST", url: "/api/categories" });
    request.flush({ error: { code: "CONFLICT", message: "Already used.", fields: { name: "Choose a different name." } } }, { status: 409, statusText: "Conflict" });
    fixture.detectChanges();
    expect(fixture.componentInstance.form.getRawValue()).toEqual({ name: "Salary", type: "income" });
    expect(fixture.nativeElement.querySelector("#category-name-error")?.textContent).toContain("Choose a different name.");
  });
});
