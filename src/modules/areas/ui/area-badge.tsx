"use client";

import { cn } from "@/shared/lib/cn";
import { colorClasses } from "@/shared/ui/color";

import type { Area } from "../domain";
import { AreaIcon } from "./area-icon";
import { useAreaLabel } from "./use-areas";

export function AreaBadge({ area, className }: { area: Area; className?: string }) {
  const label = useAreaLabel();
  return (
    <span
      className={cn(
        "inline-flex max-w-40 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        colorClasses[area.color].soft,
        className,
      )}
    >
      <AreaIcon icon={area.icon} className="size-3" />
      <span className="truncate">{label(area)}</span>
    </span>
  );
}
