"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";

import { Button } from "@/shared/ui/button";
import { useMounted } from "@/shared/ui/use-mounted";

const order = ["light", "dark", "system"] as const;
type ThemeChoice = (typeof order)[number];

const icons = { light: Sun, dark: Moon, system: Monitor } satisfies Record<ThemeChoice, unknown>;

function toChoice(value: string | undefined): ThemeChoice {
  return order.find((choice) => choice === value) ?? "system";
}

/** Compact toggle for the top bar: cycles light → dark → system. */
export function ThemeToggle() {
  const t = useTranslations("shell.theme");
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  const current = mounted ? toChoice(theme) : "system";
  const next = order[(order.indexOf(current) + 1) % order.length]!;
  const Icon = icons[current];

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(next)}
      aria-label={`${t("label")}: ${t(current)}`}
      title={`${t("label")}: ${t(current)}`}
      data-testid="theme-toggle"
    >
      <Icon />
    </Button>
  );
}

/** Segmented control used on the settings page. */
export function ThemeSelector() {
  const t = useTranslations("shell.theme");
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const current = mounted ? toChoice(theme) : null;

  return (
    <div
      role="radiogroup"
      aria-label={t("label")}
      className="inline-flex rounded-md border border-border bg-surface-muted p-0.5"
    >
      {order.map((choice) => {
        const Icon = icons[choice];
        const selected = current === choice;
        return (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(choice)}
            className={
              selected
                ? "inline-flex items-center gap-1.5 rounded-sm bg-surface px-3 py-1.5 text-sm font-medium text-foreground shadow-xs"
                : "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            }
          >
            <Icon className="size-4" />
            {t(choice)}
          </button>
        );
      })}
    </div>
  );
}
