"use client";

import { useFormatter } from "next-intl";
import { useCallback } from "react";

import { currencyPrecision } from "../domain";

const DATE = { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" } as const;
const SHORT_DATE = { month: "numeric", day: "numeric", timeZone: "UTC" } as const;

/**
 * Formats exact decimal strings as money. Intl formats a numeric *string* without going through a
 * float, so large balances keep every digit.
 */
export function useMoney() {
  const format = useFormatter();
  return useCallback(
    (value: string, currency: string, options: { signed?: boolean } = {}) => {
      const digits = currencyPrecision(currency);
      return format.number(value as unknown as number, {
        style: "currency",
        currency,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        signDisplay: options.signed ? "exceptZero" : "auto",
      });
    },
    [format],
  );
}

/** Date-only strings ("YYYY-MM-DD") as calendar days, independent of the viewer's time zone. */
export function useDay() {
  const format = useFormatter();
  return useCallback(
    (date: string, short = false) =>
      format.dateTime(new Date(`${date}T00:00:00Z`), short ? SHORT_DATE : DATE),
    [format],
  );
}
