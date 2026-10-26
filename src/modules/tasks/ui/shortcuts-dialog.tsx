"use client";

import { useTranslations } from "next-intl";

import { Dialog } from "@/shared/ui/dialog";

const shortcuts = [
  { keys: ["j", "↓"], label: "next" },
  { keys: ["k", "↑"], label: "previous" },
  { keys: ["Enter", "o"], label: "openTask" },
  { keys: ["x"], label: "toggle" },
  { keys: ["/"], label: "search" },
  { keys: ["n"], label: "quickAdd" },
  { keys: ["Esc"], label: "close" },
  { keys: ["?"], label: "help" },
] as const;

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("tasks.shortcuts");
  return (
    <Dialog open={open} onClose={onClose} title={t("title")}>
      <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
        {shortcuts.map((shortcut) => (
          <div key={shortcut.label} className="contents">
            <dt className="text-muted-foreground">{t(shortcut.label)}</dt>
            <dd className="flex items-center justify-end gap-1">
              {shortcut.keys.map((key, index) => (
                <span key={key} className="flex items-center gap-1">
                  {index > 0 ? (
                    <span className="text-xs text-muted-foreground">{t("or")}</span>
                  ) : null}
                  <kbd className="min-w-6 rounded border border-border bg-surface-muted px-1.5 py-0.5 text-center font-mono text-xs">
                    {key}
                  </kbd>
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
