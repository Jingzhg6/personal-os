"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { cn } from "../lib/cn";

interface PopoverProps {
  /** Renders the trigger; spread `props` onto a button. */
  trigger: (props: {
    onClick: () => void;
    "aria-expanded": boolean;
    "aria-controls": string;
  }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "start" | "end";
  className?: string;
}

/**
 * Lightweight popover: closes on outside pointer-down and on Escape. Escape is consumed
 * (preventDefault + stopPropagation) so it doesn't also close surrounding panels.
 */
export function Popover({ trigger, children, align = "start", className }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      {trigger({ onClick: () => setOpen((o) => !o), "aria-expanded": open, "aria-controls": id })}
      {open ? (
        <div
          id={id}
          className={cn(
            "absolute top-full z-30 mt-1 min-w-48 rounded-lg border border-border bg-surface-raised p-1.5 shadow-md",
            align === "end" ? "right-0" : "left-0",
            className,
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}

/** A checkable row inside a popover menu. */
export function MenuCheckbox({
  checked,
  onChange,
  children,
  type = "checkbox",
}: {
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
  type?: "checkbox" | "radio";
}) {
  return (
    <button
      type="button"
      role={type === "radio" ? "menuitemradio" : "menuitemcheckbox"}
      aria-checked={checked}
      onClick={onChange}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-muted"
    >
      <span
        aria-hidden
        className={cn(
          "flex size-4 shrink-0 items-center justify-center border",
          type === "radio" ? "rounded-full" : "rounded-sm",
          checked ? "border-primary bg-primary" : "border-input",
        )}
      >
        {checked ? (
          <span
            className={cn(
              "bg-primary-foreground",
              type === "radio" ? "size-1.5 rounded-full" : "size-2 rounded-[1px]",
            )}
          />
        ) : null}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
    </button>
  );
}
