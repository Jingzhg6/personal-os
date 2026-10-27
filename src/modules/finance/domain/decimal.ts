/*
 * Exact decimal arithmetic for money and FX rates (ADR 0019). Values travel as strings
 * ("1234.56", "0.1282"), exactly as PostgreSQL `numeric` returns them, and are computed here with
 * scaled BigInts — never with JavaScript floating point. Rounding happens only where a figure is
 * stored or shown, half away from zero.
 */

export interface Dec {
  /** The value × 10^scale. */
  units: bigint;
  scale: number;
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

// BigInt constants (the TypeScript target predates bigint literals).
const B0 = BigInt(0);
const B1 = BigInt(1);
const B2 = BigInt(2);
const B10 = BigInt(10);

export function isDecimalString(value: string): boolean {
  return DECIMAL.test(value);
}

export function dec(value: string | number | bigint): Dec {
  if (typeof value === "bigint") return { units: value, scale: 0 };
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!DECIMAL.test(text)) throw new RangeError(`Not a decimal: ${text}`);
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const units = BigInt(`${whole}${fraction}`);
  return { units: negative ? -units : units, scale: fraction.length };
}

const pow10 = (n: number) => B10 ** BigInt(n);

function rescale(a: Dec, scale: number): bigint {
  return scale >= a.scale ? a.units * pow10(scale - a.scale) : a.units / pow10(a.scale - scale);
}

export function add(a: Dec, b: Dec): Dec {
  const scale = Math.max(a.scale, b.scale);
  return { units: rescale(a, scale) + rescale(b, scale), scale };
}

export function sub(a: Dec, b: Dec): Dec {
  return add(a, { units: -b.units, scale: b.scale });
}

export function mul(a: Dec, b: Dec): Dec {
  return { units: a.units * b.units, scale: a.scale + b.scale };
}

export function sum(values: readonly Dec[]): Dec {
  return values.reduce((total, v) => add(total, v), ZERO);
}

export const ZERO: Dec = { units: B0, scale: 0 };

/** Rounds to `scale` decimals, half away from zero (the usual commercial rounding). */
export function round(a: Dec, scale: number): Dec {
  if (a.scale <= scale) return { units: rescale(a, scale), scale };
  const divisor = pow10(a.scale - scale);
  const quotient = a.units / divisor; // truncates towards zero
  const remainder = a.units % divisor;
  const twice = (remainder < B0 ? -remainder : remainder) * B2;
  const bump = twice >= divisor ? (a.units < B0 ? -B1 : B1) : B0;
  return { units: quotient + bump, scale };
}

export function compare(a: Dec, b: Dec): -1 | 0 | 1 {
  const diff = sub(a, b).units;
  return diff === B0 ? 0 : diff < B0 ? -1 : 1;
}

export const isZero = (a: Dec) => a.units === B0;
export const isNegative = (a: Dec) => a.units < B0;

/** Decimal string with exactly `scale` decimals (rounded) — or the value's own scale. */
export function toFixed(a: Dec, scale = a.scale): string {
  const r = round(a, scale);
  const negative = r.units < B0;
  const digits = (negative ? -r.units : r.units).toString().padStart(scale + 1, "0");
  const whole = scale > 0 ? digits.slice(0, -scale) : digits;
  const fraction = scale > 0 ? `.${digits.slice(-scale)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/** Number of decimals written in a decimal string ("12.50" → 2). */
export function decimalPlaces(value: string): number {
  const dot = value.indexOf(".");
  return dot < 0 ? 0 : value.length - dot - 1;
}

/**
 * For display only (Intl formatting needs a number). Safe for amounts up to 15 significant
 * digits; never feed the result back into a calculation.
 */
export function toDisplayNumber(a: Dec): number {
  return Number(toFixed(a));
}
