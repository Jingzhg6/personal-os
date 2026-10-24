import type { Formats } from "next-intl";

/** Named date/number formats. Components refer to these names, never to raw options. */
export const formats = {
  dateTime: {
    short: { year: "numeric", month: "short", day: "numeric" },
    long: { year: "numeric", month: "long", day: "numeric", weekday: "long" },
    time: { hour: "2-digit", minute: "2-digit" },
  },
  number: {
    percent: { style: "percent", maximumFractionDigits: 0 },
  },
} satisfies Formats;
