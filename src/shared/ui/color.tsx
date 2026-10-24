import type { ColorId } from "../lib/colors";
import { cn } from "../lib/cn";

/** Literal class names so Tailwind can see them. */
export const colorClasses: Record<ColorId, { dot: string; soft: string }> = {
  gray: { dot: "bg-zinc-400", soft: "bg-zinc-500/12 text-zinc-700 dark:text-zinc-300" },
  red: { dot: "bg-red-500", soft: "bg-red-500/12 text-red-700 dark:text-red-300" },
  orange: { dot: "bg-orange-500", soft: "bg-orange-500/12 text-orange-700 dark:text-orange-300" },
  amber: { dot: "bg-amber-500", soft: "bg-amber-500/14 text-amber-700 dark:text-amber-300" },
  green: {
    dot: "bg-emerald-500",
    soft: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  },
  teal: { dot: "bg-teal-500", soft: "bg-teal-500/12 text-teal-700 dark:text-teal-300" },
  blue: { dot: "bg-blue-500", soft: "bg-blue-500/12 text-blue-700 dark:text-blue-300" },
  indigo: { dot: "bg-indigo-500", soft: "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300" },
  violet: { dot: "bg-violet-500", soft: "bg-violet-500/12 text-violet-700 dark:text-violet-300" },
  pink: { dot: "bg-pink-500", soft: "bg-pink-500/12 text-pink-700 dark:text-pink-300" },
};

export function ColorDot({ color, className }: { color: ColorId; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        colorClasses[color].dot,
        className,
      )}
    />
  );
}
