/** User-selectable colours, stored as these stable identifiers (never as CSS values). */
export const colorIds = [
  "gray",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "violet",
  "pink",
] as const;

export type ColorId = (typeof colorIds)[number];
