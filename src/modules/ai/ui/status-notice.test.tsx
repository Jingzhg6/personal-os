import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import { sourceMessages } from "@/shared/i18n/messages";

import type { AiStatus } from "../domain";
import { AiStatusNotice, GenerateError } from "./status-notice";

const status = vi.hoisted(() => ({ current: null as AiStatus | null }));

vi.mock("./use-ai", () => ({ useAiStatus: () => ({ data: status.current }) }));

const wrap = (ui: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="zh-CN" messages={sourceMessages} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );

const limits = { perMinute: 5, daily: 30, usedToday: 2 };

describe("AI status", () => {
  it("shows an unavailable state when no provider is configured", () => {
    status.current = {
      available: false,
      unavailableReason: "off",
      provider: "off",
      model: null,
      simulated: false,
      limits,
    };
    wrap(<AiStatusNotice />);
    expect(screen.getByTestId("ai-unavailable")).toHaveTextContent("AI 顾问未启用");
    expect(screen.getByTestId("ai-unavailable")).toHaveTextContent("不会生成任何 AI 分析");
  });

  it("says when a provider is chosen but its key is missing (M11.1)", () => {
    status.current = {
      available: false,
      unavailableReason: "missing_key",
      provider: "off",
      model: null,
      simulated: false,
      limits,
    };
    wrap(<AiStatusNotice />);
    expect(screen.getByTestId("ai-unavailable")).toHaveTextContent("没有设置 AI_API_KEY");
  });

  it("labels the mock provider as simulated, never as AI", () => {
    status.current = {
      available: true,
      unavailableReason: null,
      provider: "mock",
      model: "mock",
      simulated: true,
      limits,
    };
    wrap(<AiStatusNotice />);
    expect(screen.getByTestId("ai-simulated")).toHaveTextContent("模拟模式");
    expect(screen.getByTestId("ai-status")).toHaveTextContent("不是 AI 的分析");
    expect(screen.getByTestId("ai-status")).toHaveTextContent("今天已用 2/30 次");
  });

  it("names a real model without anything else about the configuration", () => {
    status.current = {
      available: true,
      unavailableReason: null,
      provider: "anthropic",
      model: "claude-opus-5-5",
      simulated: false,
      limits,
    };
    wrap(<AiStatusNotice />);
    expect(screen.getByTestId("ai-status")).toHaveTextContent("模型：claude-opus-5-5");
    expect(screen.queryByTestId("ai-simulated")).toBeNull();
  });
});

describe("generation errors", () => {
  it.each([
    ["ai.timeout", "AI 响应超时"],
    ["ai.rate_limited", "请求过多"],
    ["ai.quota_exceeded", "使用上限"],
    ["ai.malformed_output", "格式不正确"],
    ["ai.not_configured", "未配置"],
    ["ai.provider_error", "AI 服务出错"],
    ["ai.auth_failed", "AI_API_KEY"],
    ["ai.model_unavailable", "AI_MODEL"],
    ["ai.incomplete_output", "不完整"],
  ])("explains %s without inventing an answer", (code, text) => {
    wrap(<GenerateError error={{ data: { domainCode: code } }} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-code", code);
    expect(alert).toHaveTextContent("没有生成任何内容");
    expect(alert).toHaveTextContent(text);
  });
});
