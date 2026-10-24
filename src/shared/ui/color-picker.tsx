"use client";

import { useTranslations } from "next-intl";

import { colorIds, type ColorId } from "../lib/colors";
import { cn } from "../lib/cn";
import { colorClasses } from "./color";

export function ColorPicker({
  value,
  onChange,
  label,
}: {
  value: ColorId;
  onChange: (color: ColorId) => void;
  label: string;
}) {
  const t = useTranslations("common.colors");
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {colorIds.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={t(color)}
          title={t(color)}
          onClick={() => onChange(color)}
          className={cn(
            "flex size-6 items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition",
            value === color ? "ring-2 ring-ring" : "hover:ring-2 hover:ring-border",
          )}
        >
          <span className={cn("size-3.5 rounded-full", colorClasses[color].dot)} />
        </button>
      ))}
    </div>
  );
}
