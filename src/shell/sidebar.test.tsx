import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import { sourceMessages } from "@/shared/i18n/messages";

import { Sidebar } from "./sidebar";

const pathname = vi.hoisted(() => ({ current: "/tasks/matrix" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

function renderSidebar() {
  return render(
    <NextIntlClientProvider locale="zh-CN" messages={sourceMessages} timeZone="UTC">
      <Sidebar user={{ name: "Jin", email: "jin@example.test" }} />
    </NextIntlClientProvider>,
  );
}

describe("Sidebar", () => {
  it("renders the navigation sections and items in Simplified Chinese", () => {
    renderSidebar();
    const nav = screen.getByRole("navigation", { name: "主导航" });
    const headings = within(nav)
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual([
      "概览",
      "工作与事务",
      "任务",
      "个人成长与生活",
      "资料与记录",
      "财务",
      "系统与自动化",
    ]);
    expect(within(nav).getByRole("link", { name: /仪表盘/ })).toHaveAttribute("href", "/");
    expect(within(nav).getByRole("link", { name: /设置/ })).toHaveAttribute("href", "/settings");
  });

  it("marks the current page", () => {
    pathname.current = "/tasks/matrix";
    renderSidebar();
    expect(screen.getByRole("link", { current: "page" })).toHaveTextContent("四象限矩阵");
  });

  it("tags later-phase items with their phase", () => {
    renderSidebar();
    expect(screen.getByRole("link", { name: /^健身\s*P3$/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /全部任务/ })).not.toHaveTextContent(/P\d/);
  });

  it("collapses and expands a section and remembers it across reloads", () => {
    window.localStorage.clear();
    pathname.current = "/tasks/matrix";
    const { unmount } = renderSidebar();
    const finance = screen.getByRole("button", { name: "财务" });
    expect(finance).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /资产总览/ })).toBeVisible();

    fireEvent.click(finance);
    expect(finance).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: /资产总览/ })).toBeNull();
    expect(JSON.parse(window.localStorage.getItem("personal-os.sidebar.collapsed")!)).toEqual([
      "finance",
    ]);

    unmount();
    renderSidebar();
    expect(screen.getByRole("button", { name: "财务" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "财务" }));
    expect(screen.getByRole("link", { name: /资产总览/ })).toBeVisible();
  });

  it("reopens a collapsed section when its page is the current one", () => {
    window.localStorage.setItem("personal-os.sidebar.collapsed", JSON.stringify(["tasks", "x"]));
    pathname.current = "/tasks/matrix";
    renderSidebar();
    expect(screen.getByRole("button", { name: "任务" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { current: "page" })).toHaveTextContent("四象限矩阵");
  });

  it("shows the signed-in user", () => {
    renderSidebar();
    expect(screen.getByText("Jin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
  });
});
