import { TestBed } from "@angular/core/testing";

import { AppShellComponent } from "./app.component";

describe("AppShellComponent", () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
    }).compileComponents();
  });

  it("renders a public application shell without private data", () => {
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain("Budget Tracker");
    expect(text).not.toContain("Household");
  });
});
