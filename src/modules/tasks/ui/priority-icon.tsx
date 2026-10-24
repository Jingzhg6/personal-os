import { Flag } from "lucide-react";

import { cn } from "@/shared/lib/cn";

const tones = ["", "text-blue-500", "text-amber-500", "text-orange-500", "text-red-500"];

export function PriorityIcon({ priority, className }: { priority: number; className?: string }) {
  if (!priority) return null;
  return (
    <Flag
      aria-hidden
      className={cn(
        "size-3.5 shrink-0",
        tones[priority],
        priority === 4 && "fill-current",
        className,
      )}
    />
  );
}
