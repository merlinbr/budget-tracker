import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting, HttpTestingController } from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";

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

  it.each([{ type: "expense" as const }, { type: "income" as const }])("creates a $type category", ({ type }) => {
    fixture.componentInstance.startAdd();
    fixture.componentInstance.form.setValue({ name: type === "expense" ? "Groceries" : "Salary", type });
    fixture.componentInstance.save();
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
