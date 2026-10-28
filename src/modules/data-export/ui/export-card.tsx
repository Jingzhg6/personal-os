"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/shared/ui/button";
import { useToast } from "@/shared/ui/toast";

const FALLBACK_NAME = "personal-os-export.json";

function fileNameOf(response: Response): string {
  const header = response.headers.get("content-disposition") ?? "";
  return /filename="([^"]+)"/.exec(header)?.[1] ?? FALLBACK_NAME;
}

/** Saves a blob through a temporary link (works on desktop and mobile browsers). */
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  // Safari needs the URL a little longer than the click.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The 导出数据 action: asks the server for the file and saves it on this device. */
export function ExportDataCard() {
  const t = useTranslations("settings.export");
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [last, setLast] = useState<{ file: string; count: number } | null>(null);

  async function exportData() {
    setPending(true);
    try {
      const response = await fetch("/api/export", { method: "POST" });
      if (!response.ok) throw new Error(`export ${response.status}`);
      const file = fileNameOf(response);
      const count = Number(response.headers.get("x-export-records") ?? 0);
      save(await response.blob(), file);
      setLast({ file, count });
      toast.show(t("success", { count, file }));
    } catch {
      toast.show(t("failed"), "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="export-data">
      <p className="text-sm text-muted-foreground">{t("includes")}</p>
      <p className="text-sm text-muted-foreground">{t("excludes")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={exportData} disabled={pending} data-testid="export-button">
          <Download />
          {pending ? t("exporting") : t("button")}
        </Button>
        {last ? (
          <p role="status" className="text-xs text-muted-foreground" data-testid="export-last">
            {t("lastExport", last)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
