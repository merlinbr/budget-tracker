import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting } from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { of } from "rxjs";

import { AuthService } from "../../core/auth/auth.service";
import { LoginPage } from "./login.page";

describe("LoginPage", () => {
  let fixture: ComponentFixture<LoginPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
  });

  it("renders labelled fields and a keyboard-submit form", () => {
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('label[for="username"]')?.textContent).toContain(
      "Username",
    );
    expect(element.querySelector('label[for="password"]')?.textContent).toContain(
      "Password",
    );
    expect(element.querySelector("form")).not.toBeNull();
    expect(element.querySelector('input[autocomplete="username"]')).not.toBeNull();
    expect(element.querySelector('input[autocomplete="current-password"]')).not.toBeNull();
    expect(element.querySelector('button[type="submit"]')).not.toBeNull();
  });

  it("does not submit invalid short passwords", () => {
    fixture.componentInstance.form.setValue({ username: "merlin", password: "short" });
    fixture.componentInstance.submit();

    expect(fixture.componentInstance.isSubmitting()).toBe(false);
    expect(fixture.componentInstance.form.controls.password.hasError("minlength")).toBe(true);
  });

  it("counts Unicode code points for credential bounds", () => {
    fixture.componentInstance.form.setValue({
      username: "😀".repeat(60),
      password: "😀".repeat(600),
    });

    expect(fixture.componentInstance.form.valid).toBe(true);
  });

  it("normalizes usernames without changing passwords", () => {
    const password = "Pässwörd 😀 stays exact";
    const login = vi.spyOn(TestBed.inject(AuthService), "login").mockReturnValue(
      of({
        user: { id: 1, username: "user", displayName: "User" },
        household: { id: 1, name: "Household" },
      }),
    );

    fixture.componentInstance.form.setValue({
      username: "  USER  ",
      password,
    });
    fixture.componentInstance.submit();

    expect(login).toHaveBeenCalledWith("user", password);
  });
});
