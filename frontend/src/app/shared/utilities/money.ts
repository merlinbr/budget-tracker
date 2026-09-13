export function parseMoney(text: string): number | null {
  const match = /^([0-9]{1,14})(?:[.,]([0-9]{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

export function parseSignedMoney(text: string): number | null {
  const value = text.trim();
  if (!/^-?[0-9]{1,14}(?:[.,][0-9]{1,2})?$/.test(value)) return null;
  const negative = value.startsWith("-");
  const cents = parseMoney(negative ? value.slice(1) : value);
  return cents === null ? null : negative && cents !== 0 ? -cents : cents;
}

export function moneyInput(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError("Invalid integer cents");
  const absolute = BigInt(Math.abs(cents));
  return `${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function signedMoneyInput(cents: number): string {
  return `${cents < 0 ? "-" : ""}${moneyInput(cents)}`;
}

const wholeEuroFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

export function formatMoney(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError("Invalid integer cents");
  const absolute = BigInt(Math.abs(cents));
  return `${cents < 0 ? "-" : ""}${wholeEuroFormatter.format(absolute / 100n)},${String(absolute % 100n).padStart(2, "0")}\u00a0€`;
}

export function localToday(now = new Date()): string {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
