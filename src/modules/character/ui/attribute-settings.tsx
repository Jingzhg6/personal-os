"use client";

import { ArrowDown, ArrowUp, ChevronLeft, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { colorIds, type ColorId } from "@/shared/lib/colors";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { colorClasses } from "@/shared/ui/color";
import { ColorPicker } from "@/shared/ui/color-picker";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/page-header";
import { useToast } from "@/shared/ui/toast";

import { isLegacyAttribute, type DevelopmentAttribute } from "../domain";
import {
  useAttributeLabel,
  useAttributeMutations,
  useDevelopmentAttributes,
} from "./use-character";

/** Create, rename, reorder, archive and delete development attributes. */
export function AttributeSettings() {
  const t = useTranslations("character.settings");
  const { data: attributes = [] } = useDevelopmentAttributes();
  const mutations = useAttributeMutations();
  const toast = useToast();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const active = attributes.filter((a) => !a.archivedAt);
  const archived = attributes.filter((a) => a.archivedAt);

  function add(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const color: ColorId = colorIds[(attributes.length + 3) % colorIds.length]!;
    mutations.create.mutate(
      { name: name.trim(), icon: icon.trim() || null, color },
      {
        onSuccess: () => {
          setName("");
          setIcon("");
          toast.show(t("added"));
        },
      },
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link
        href="/character"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {t("back")}
      </Link>
      <PageHeader title={t("title")} description={t("description")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("active")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul
            aria-label={t("active")}
            className="divide-y divide-border rounded-lg border border-border"
          >
            {active.map((attribute, index) => (
              <AttributeRow
                key={attribute.id}
                attribute={attribute}
                isFirst={index === 0}
                isLast={index === active.length - 1}
              />
            ))}
          </ul>
          <form onSubmit={add} className="flex flex-wrap gap-2">
            <Input
              value={icon}
              onChange={(event) => setIcon(event.target.value)}
              placeholder="🙂"
              aria-label={t("icon")}
              maxLength={8}
              className="w-16 text-center"
            />
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("namePlaceholder")}
              aria-label={t("namePlaceholder")}
              maxLength={40}
              className="min-w-48 flex-1"
            />
            <Button type="submit" disabled={!name.trim() || mutations.create.isPending}>
              <Plus />
              {t("add")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("archived")}</CardTitle>
          <CardDescription>{t("archivedHint")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {archived.length === 0 ? (
            <CardDescription>{t("noArchived")}</CardDescription>
          ) : (
            <ul
              aria-label={t("archived")}
              className="divide-y divide-border rounded-lg border border-border"
            >
              {archived.map((attribute) => (
                <ArchivedRow key={attribute.id} attribute={attribute} />
              ))}
            </ul>
          )}
          {archived.some(isLegacyAttribute) ? (
            <p className="text-xs text-muted-foreground">{t("legacyHint")}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function AttributeRow({
  attribute,
  isFirst,
  isLast,
}: {
  attribute: DevelopmentAttribute;
  isFirst: boolean;
  isLast: boolean;
}) {
  const t = useTranslations("character.settings");
  const tKeys = useTranslations("character.attributes.keys");
  const label = useAttributeLabel();
  const toast = useToast();
  const mutations = useAttributeMutations();
  const defaultLabel = attribute.systemKey ? tKeys(attribute.systemKey) : null;
  const [name, setName] = useState(label(attribute));
  const [icon, setIcon] = useState(attribute.icon ?? "");
  // Reflects the click at once; the saved value catches up after the refetch.
  const [onRadar, setOnRadar] = useState(attribute.onRadar);
  const [confirming, setConfirming] = useState(false);
  const update = (patch: Parameters<typeof mutations.update.mutate>[0]["patch"]) =>
    mutations.update.mutate(
      { id: attribute.id, patch },
      { onSuccess: () => toast.show(t("saved")) },
    );

  function saveName() {
    const trimmed = name.trim();
    // Seeded attributes: keeping (or clearing back to) the translated default stores no name.
    const next =
      attribute.systemKey && (trimmed === "" || trimmed === defaultLabel) ? null : trimmed;
    if (next === "") return setName(label(attribute));
    if (next === attribute.name) return setName(next ?? defaultLabel ?? "");
    update({ name: next });
  }

  function saveIcon() {
    const next = icon.trim() || null;
    if (next !== attribute.icon) update({ icon: next });
  }

  return (
    <li data-testid="attribute-setting" className="flex flex-col gap-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={icon}
          onChange={(event) => setIcon(event.target.value)}
          onBlur={saveIcon}
          aria-label={`${t("icon")}: ${label(attribute)}`}
          maxLength={8}
          className={cn("w-12 shrink-0 px-1 text-center", colorClasses[attribute.color].soft)}
        />
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={saveName}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          aria-label={`${t("name")}: ${label(attribute)}`}
          maxLength={40}
          className="min-w-32 flex-1"
        />
        <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">
          {t("xp", { xp: attribute.xp })}
        </span>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isFirst}
            onClick={() => mutations.move.mutate({ id: attribute.id, direction: "up" })}
            aria-label={t("moveUp", { name: label(attribute) })}
            title={t("moveUp", { name: label(attribute) })}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isLast}
            onClick={() => mutations.move.mutate({ id: attribute.id, direction: "down" })}
            aria-label={t("moveDown", { name: label(attribute) })}
            title={t("moveDown", { name: label(attribute) })}
          >
            <ArrowDown />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-14">
        <ColorPicker
          value={attribute.color}
          onChange={(color) => update({ color })}
          label={`${t("color")}: ${label(attribute)}`}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onRadar}
            onChange={(event) => {
              setOnRadar(event.target.checked);
              update({ onRadar: event.target.checked });
            }}
            className="size-4 accent-primary"
          />
          {t("onRadar")}
        </label>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="secondary" size="sm" onClick={() => update({ archived: true })}>
            {t("archive")}
          </Button>
          {attribute.xp === 0 ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setConfirming(true)}
              aria-label={t("delete", { name: label(attribute) })}
              title={t("delete", { name: label(attribute) })}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      </div>
      <DeleteDialog attribute={attribute} open={confirming} onClose={() => setConfirming(false)} />
    </li>
  );
}

function ArchivedRow({ attribute }: { attribute: DevelopmentAttribute }) {
  const t = useTranslations("character.settings");
  const label = useAttributeLabel();
  const mutations = useAttributeMutations();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  return (
    <li data-testid="attribute-archived" className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
      <span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground">
        <span
          aria-hidden
          className={cn("size-2 rounded-full", colorClasses[attribute.color].dot)}
        />
        {attribute.icon ? <span aria-hidden>{attribute.icon}</span> : null}
        <span className="truncate">{label(attribute)}</span>
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {t("xp", { xp: attribute.xp })}
      </span>
      <Button
        variant="secondary"
        size="sm"
        onClick={() =>
          mutations.update.mutate(
            { id: attribute.id, patch: { archived: false } },
            { onSuccess: () => toast.show(t("saved")) },
          )
        }
      >
        {t("unarchive")}
      </Button>
      {attribute.xp === 0 ? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setConfirming(true)}
          aria-label={t("delete", { name: label(attribute) })}
        >
          <Trash2 />
        </Button>
      ) : null}
      <DeleteDialog attribute={attribute} open={confirming} onClose={() => setConfirming(false)} />
    </li>
  );
}

function DeleteDialog({
  attribute,
  open,
  onClose,
}: {
  attribute: DevelopmentAttribute;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("character.settings");
  const tc = useTranslations("common");
  const label = useAttributeLabel();
  const mutations = useAttributeMutations();
  const toast = useToast();
  return (
    <ConfirmDialog
      open={open}
      title={t("deleteTitle", { name: label(attribute) })}
      description={t("deleteBody")}
      confirmLabel={tc("delete")}
      pending={mutations.remove.isPending}
      onCancel={onClose}
      onConfirm={() =>
        mutations.remove.mutate(
          { id: attribute.id },
          {
            onSuccess: () => {
              onClose();
              toast.show(t("deleted"));
            },
          },
        )
      }
    />
  );
}
