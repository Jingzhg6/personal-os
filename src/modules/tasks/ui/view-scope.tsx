"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { AreaBadge, useAreaLabel, useAreas } from "@/modules/areas/ui";
import { useTRPC } from "@/shared/trpc/react";
import { Button } from "@/shared/ui/button";
import { ColorDot } from "@/shared/ui/color";
import { MenuCheckbox, Popover } from "@/shared/ui/popover";
import { useToast } from "@/shared/ui/toast";
import { useErrorMessage } from "@/shared/ui/use-error-message";

import type { TaskViewScope } from "../domain";

/** Shows which areas a navigation view includes, with an editor. */
export function ViewScopeBar({ scope }: { scope: TaskViewScope }) {
  const t = useTranslations("tasks.views");
  const { data: areas = [] } = useAreas();
  const included = areas.filter((area) => scope.areaIds.includes(area.id));

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">{t("scope")}</span>
      {included.map((area) => (
        <AreaBadge key={area.id} area={area} />
      ))}
      <ViewScopeEditor scope={scope} />
    </div>
  );
}

export function ViewScopeEditor({
  scope,
  prominent = false,
}: {
  scope: TaskViewScope;
  prominent?: boolean;
}) {
  const t = useTranslations("tasks.views");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const areaLabel = useAreaLabel();
  const { data: areas = [] } = useAreas();
  const [selected, setSelected] = useState<string[]>(scope.areaIds);
  const update = useMutation(
    trpc.tasks.views.update.mutationOptions({
      onSuccess: () => toast.show(t("scopeSaved")),
      onError: (error) => toast.show(errorMessage(error), "error"),
      onSettled: () => queryClient.invalidateQueries(trpc.tasks.pathFilter()),
    }),
  );

  return (
    <Popover
      trigger={(props) => (
        <Button
          variant={prominent ? "primary" : "ghost"}
          size="sm"
          {...props}
          onClick={() => {
            setSelected(scope.areaIds);
            props.onClick();
          }}
        >
          <Pencil />
          {t("editScope")}
        </Button>
      )}
    >
      {(close) => (
        <div className="flex w-60 flex-col gap-1">
          <div
            role="menu"
            aria-label={t("scope")}
            className="flex max-h-64 flex-col overflow-y-auto"
          >
            {areas.length === 0 ? (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">{t("noAreas")}</p>
            ) : null}
            {areas.map((area) => (
              <MenuCheckbox
                key={area.id}
                checked={selected.includes(area.id)}
                onChange={() =>
                  setSelected((ids) =>
                    ids.includes(area.id) ? ids.filter((id) => id !== area.id) : [...ids, area.id],
                  )
                }
              >
                <ColorDot color={area.color} />
                <span className="truncate">{areaLabel(area)}</span>
              </MenuCheckbox>
            ))}
          </div>
          <Button
            size="sm"
            disabled={update.isPending}
            onClick={() =>
              update.mutate({ key: scope.key, areaIds: selected }, { onSuccess: close })
            }
          >
            {t("saveScope")}
          </Button>
        </div>
      )}
    </Popover>
  );
}
