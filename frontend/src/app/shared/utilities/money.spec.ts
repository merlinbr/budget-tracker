import { expect, it } from "vitest";
import { formatMoney, localToday, moneyInput, parseMoney, parseSignedMoney, signedMoneyInput } from "./money";

it("keeps signed initial balances and unsigned transaction entry exact", () => {
  expect(parseMoney("84,72")).toBe(8472);
  expect(parseMoney(" 84.7 ")).toBe(8470);
  expect(parseSignedMoney("-0.01")).toBe(-1);
  expect(parseSignedMoney("0")).toBe(0);
  expect(parseMoney("-1")).toBeNull();
  for (const text of ["", "+1", "1e2", "1.234", "1,000.00", "1 000", ".5", "1.", "--1", "90071992547409.92"]) {
    expect(parseSignedMoney(text)).toBeNull();
  }
  for (const cents of [0, 1, -8472, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
    expect(parseSignedMoney(signedMoneyInput(cents))).toBe(cents);
    expect(parseMoney(moneyInput(cents))).toBe(Math.abs(cents));
  }
  expect(formatMoney(-1)).toContain("-0,01");
  expect(formatMoney(Number.MAX_SAFE_INTEGER)).toContain("90.071.992.547.409,91");
});

it("uses local calendar components for today", () => {
  expect(localToday(new Date(2026, 8, 7, 0, 5))).toBe("2026-09-07");
});
