"use client";

import { Check, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/shared/lib/cn";
import { ColorDot } from "@/shared/ui/color";

import { tagName, type Tag } from "../domain";

const fold = (value: string) => value.normalize("NFKC").toLocaleLowerCase();

export function TagPicker({
  tags,
  value,
  onChange,
  onCreate,
}: {
  tags: Tag[];
  value: string[];
  onChange: (tagIds: string[]) => void;
  onCreate: (name: string) => Promise<Tag>;
}) {
  const t = useTranslations("tasks.tagPicker");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const selected = value
    .map((id) => tags.find((tag) => tag.id === id))
    .filter((tag): tag is Tag => Boolean(tag));
  const matches = tags.filter((tag) => fold(tag.name).includes(fold(query.trim())));
  const canCreate =
    query.trim() !== "" &&
    !tags.some((tag) => fold(tag.name) === fold(query.trim())) &&
    tagName.safeParse(query).success;

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  async function create() {
    const tag = await onCreate(query.trim());
    onChange([...value, tag.id]);
    setQuery("");
    inputRef.current?.focus();
  }

  return (
    <div ref={containerRef} className="relative flex flex-wrap items-center gap-1.5">
      {selected.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-xs"
        >
          <ColorDot color={tag.color} />
          {tag.name}
          <button
            type="button"
            onClick={() => toggle(tag.id)}
            aria-label={t("remove", { name: tag.name })}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={listId}
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-muted-foreground hover:bg-surface-muted hover:text-foreground"
      >
        <Plus className="size-3" aria-hidden />
        {t("add")}
      </button>

      {open ? (
        <div
          className="absolute top-full left-0 z-10 mt-1 w-64 rounded-lg border border-border bg-surface-raised p-1.5 shadow-md"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }
          }}
        >
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (canCreate) void create();
                else if (matches[0]) toggle(matches[0].id);
              }
            }}
            placeholder={t("search")}
            aria-label={t("search")}
            className="mb-1 h-8 w-full rounded-md bg-surface-muted px-2 text-sm outline-none"
          />
          <ul id={listId} className="max-h-56 overflow-y-auto">
            {matches.map((tag) => (
              <li key={tag.id}>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={value.includes(tag.id)}
                  onClick={() => {
                    toggle(tag.id);
                    inputRef.current?.focus();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-muted"
                >
                  <ColorDot color={tag.color} />
                  <span className="flex-1 truncate">{tag.name}</span>
                  <Check
                    className={cn("size-3.5 text-primary", !value.includes(tag.id) && "invisible")}
                  />
                </button>
              </li>
            ))}
            {canCreate ? (
              <li>
                <button
                  type="button"
                  onClick={() => void create()}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-primary hover:bg-surface-muted"
                >
                  <Plus className="size-3.5" aria-hidden />
                  {t("create", { name: query.trim() })}
                </button>
              </li>
            ) : null}
            {!canCreate && matches.length === 0 ? (
              <li className="px-2 py-1.5 text-sm text-muted-foreground">{t("empty")}</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
