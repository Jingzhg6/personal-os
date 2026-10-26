import { cn } from "../lib/cn";

/** Accessible progress bar; `value` is 0–1 (null renders an empty track). */
export function ProgressBar({
  value,
  label,
  className,
  tone = "primary",
}: {
  value: number | null;
  label: string;
  className?: string;
  tone?: "primary" | "success";
}) {
  const percent = Math.round((value ?? 0) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-muted", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width]",
          tone === "success" ? "bg-success" : "bg-primary",
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
