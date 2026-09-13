import { ComponentFixture, TestBed } from "@angular/core/testing";

import { Account, Category, Transaction } from "../../core/api/models";
import { TransactionForm } from "./transaction-form";

const accounts: Account[] = [
  { id: 1, name: "Main", type: "checking", initialBalance: 0, balance: 0, isArchived: false },
  { id: 2, name: "Old", type: "cash", initialBalance: 0, balance: 0, isArchived: true },
  { id: 3, name: "Other old", type: "cash", initialBalance: 0, balance: 0, isArchived: true },
];
const categories: Category[] = [
  { id: 10, name: "Groceries", type: "expense", isArchived: false },
  { id: 11, name: "Salary", type: "income", isArchived: false },
  { id: 12, name: "Old groceries", type: "expense", isArchived: true },
  { id: 13, name: "Other old groceries", type: "expense", isArchived: true },
];

function setInput(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("TransactionForm", () => {
  let fixture: ComponentFixture<TransactionForm>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TransactionForm] }).compileComponents();
    fixture = TestBed.createComponent(TransactionForm);
    fixture.componentInstance.accounts = accounts;
    fixture.componentInstance.categories = categories;
    fixture.detectChanges();
  });

  it("blocks invalid, zero, and over-precise amounts with associated errors", () => {
    const form = fixture.componentInstance;
    form.form.controls.accountId.setValue(1);
    form.form.controls.categoryId.setValue(10);
    let saves = 0;
    form.save.subscribe(() => { saves += 1; });
    for (const value of ["84.723", "0", "90071992547409.92"]) {
      setInput(fixture.nativeElement.querySelector("#transaction-amount"), value);
      fixture.nativeElement.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      fixture.detectChanges();
      expect(saves).toBe(0);
      expect(form.form.controls.amount.invalid).toBe(true);
      expect(fixture.nativeElement.querySelector("#transaction-amount-error").textContent).toMatch(/valid|greater/);
      expect(fixture.nativeElement.querySelector("#transaction-amount").getAttribute("aria-describedby")).toContain("transaction-amount-error");
    }
  });

  it("emits negative comma expense and positive income cents", () => {
    const form = fixture.componentInstance;
    let emitted: number[] = [];
    form.save.subscribe((body) => { emitted.push(body.amount); });
    form.form.controls.accountId.setValue(1);
    form.form.controls.categoryId.setValue(10);
    setInput(fixture.nativeElement.querySelector("#transaction-amount"), "84,72");
    fixture.nativeElement.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.form.controls.type.setValue("income");
    form.form.controls.categoryId.setValue(11);
    setInput(fixture.nativeElement.querySelector("#transaction-amount"), "84,72");
    fixture.nativeElement.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(emitted).toEqual([-8472, 8472]);
  });


  it("clears an incompatible category when the type changes", () => {
    const form = fixture.componentInstance;
    form.form.controls.categoryId.setValue(10);
    form.form.controls.type.setValue("income");
    expect(form.form.controls.categoryId.value).toBeNull();
  });

  it("retains only the edit transaction's archived references", () => {
    const transaction: Transaction = { id: 7, accountId: 2, categoryId: 12, amount: -1, description: "Old", transactionDate: "2026-09-07", createdAt: "2026-09-07T00:00:00Z", updatedAt: "2026-09-07T00:00:00Z" };
    fixture.componentRef.setInput("transaction", transaction);
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector("#transaction-amount") as HTMLInputElement).value).toBe("0.01");
    expect(fixture.componentInstance.accountChoices().map((account) => account.id)).toEqual([1, 2]);
    expect(fixture.componentInstance.categoryChoices().map((category) => category.id)).toEqual([10, 12]);
    expect(fixture.nativeElement.querySelector("#transaction-account").textContent).toContain("Old (Archived");
    expect(fixture.nativeElement.querySelector("#transaction-category").textContent).toContain("Old groceries (Archived");
    expect(fixture.nativeElement.querySelector("#transaction-account").textContent).not.toContain("Other old");
    expect(fixture.nativeElement.querySelector("#transaction-category").textContent).not.toContain("Other old groceries");
  });

  it("reinitializes when switching from edit back to add", () => {
    fixture.componentRef.setInput("transaction", { id: 7, accountId: 2, categoryId: 12, amount: -1, description: "Old", transactionDate: "2026-09-07", createdAt: "2026-09-07T00:00:00Z", updatedAt: "2026-09-07T00:00:00Z" });
    fixture.detectChanges();
    fixture.componentInstance.form.controls.description.setValue("changed");
    fixture.componentRef.setInput("transaction", null);
    fixture.detectChanges();
    expect(fixture.componentInstance.form.getRawValue()).toMatchObject({ type: "expense", amount: "", accountId: null, categoryId: null, description: "" });
  });

  it("keeps entered values visible when a server field error is supplied", () => {
    fixture.componentRef.setInput("fieldErrors", { description: "Description is already used." });
    const form = fixture.componentInstance;
    setInput(fixture.nativeElement.querySelector("#transaction-amount"), "84,72");
    setInput(fixture.nativeElement.querySelector("#transaction-description"), "Keep this text");
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector("#transaction-amount") as HTMLInputElement).value).toBe("84,72");
    expect((fixture.nativeElement.querySelector("#transaction-description") as HTMLTextAreaElement).value).toBe("Keep this text");
    expect(fixture.nativeElement.querySelector("#transaction-description-error").textContent).toContain("already used");
  });
});
