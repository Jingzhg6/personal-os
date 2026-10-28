import { Circle, CircleCheck, CircleDashed, CircleDot, CircleX, OctagonX } from "lucide-react";

import type { ColorId } from "@/shared/lib/colors";
import { cn } from "@/shared/lib/cn";

import type { StatusCategory } from "../domain";

const icons = {
  backlog: CircleDashed,
  unstarted: Circle,
  started: CircleDot,
  completed: CircleCheck,
  cancelled: CircleX,
  failed: OctagonX,
} as const;

const tones: Record<ColorId, string> = {
  gray: "text-zinc-400",
  red: "text-red-500",
  orange: "text-orange-500",
  amber: "text-amber-500",
  green: "text-emerald-500",
  teal: "text-teal-500",
  blue: "text-blue-500",
  indigo: "text-indigo-500",
  violet: "text-violet-500",
  pink: "text-pink-500",
};

export function StatusIcon({
  category,
  color,
  className,
}: {
  category: StatusCategory;
  color?: ColorId;
  className?: string;
}) {
  const Icon = icons[category];
  return (
    <Icon
      aria-hidden
      className={cn(
        "size-[18px] shrink-0",
        color ? tones[color] : "text-muted-foreground",
        className,
      )}
    />
  );
}
