import { render, screen, within } from "@testing-library/react";
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
    for (const label of [
      "概览",
      "任务",
      "项目",
      "生活",
      "工作",
      "行政事务",
      "日历",
      "角色",
      "分析",
    ]) {
      expect(within(nav).getByRole("heading", { name: label })).toBeInTheDocument();
    }
    expect(within(nav).getByRole("link", { name: /仪表盘/ })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: /设置/ })).toHaveAttribute("href", "/settings");
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

  it("shows the signed-in user", () => {
    renderSidebar();
    expect(screen.getByText("Jin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
  });
});
