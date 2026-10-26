"use client";

import { useEffect, useRef } from "react";

import { SEARCH_INPUT_ID } from "./filter-bar";
import { QUICK_ADD_INPUT_ID } from "./quick-add";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.closest("[role=menu], [data-drag-handle]") !== null
  );
}

const rowButtons = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-task-id] > [data-row-main]"));

/**
 * List keyboard shortcuts (ignored while typing or when a dialog is open):
 *   j / ↓  next task        k / ↑  previous task      Enter / o  open
 *   x      complete/reopen   /      search             n          quick add
 *   ?      shortcut help
 */
export function useListKeyboard(
  containerRef: React.RefObject<HTMLElement | null>,
  handlers: { onHelp: () => void },
) {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const container = containerRef.current;
      if (!container || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (isTypingTarget(event.target) || document.querySelector("dialog[open]")) return;

      const rows = rowButtons(container);
      const current = rows.findIndex((row) => row === document.activeElement);
      const focusRow = (index: number) => {
        const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
        if (row) {
          event.preventDefault();
          row.focus();
          row.scrollIntoView({ block: "nearest" });
        }
      };

      switch (event.key) {
        case "j":
        case "ArrowDown":
          if (event.key === "ArrowDown" && current < 0) return;
          return focusRow(current + 1);
        case "k":
        case "ArrowUp":
          if (event.key === "ArrowUp" && current < 0) return;
          return focusRow(current < 0 ? 0 : current - 1);
        case "o":
          if (current >= 0) {
            event.preventDefault();
            rows[current]!.click();
          }
          return;
        case "x":
          if (current >= 0) {
            event.preventDefault();
            rows[current]!.parentElement?.querySelector<HTMLElement>("[data-row-toggle]")?.click();
          }
          return;
        case "/":
          event.preventDefault();
          document.getElementById(SEARCH_INPUT_ID)?.focus();
          return;
        case "n":
          event.preventDefault();
          document.getElementById(QUICK_ADD_INPUT_ID)?.focus();
          return;
        case "?":
          event.preventDefault();
          handlersRef.current.onHelp();
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [containerRef]);
}
