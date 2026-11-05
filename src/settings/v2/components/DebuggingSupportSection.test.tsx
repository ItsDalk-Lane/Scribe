import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { setInterfaceLocale } from "@/lib/i18n";
import { DebuggingSupportSection } from "./DebuggingSupportSection";
import storyMeta, { FeedbackCardsOff } from "./DebuggingSupportSection.stories";

function renderSection(offerFeedbackCards = true) {
  const props = {
    debug: false,
    onDebugChange: jest.fn(),
    frameLogEnabled: true,
    onFrameLogChange: jest.fn(),
    frameLogPath: "/tmp/obsidian-scribe/acp-frames/3f9a/acp-frames.ndjson",
    onReportIssue: jest.fn(),
    offerFeedbackCards,
    onOfferFeedbackCardsChange: jest.fn(),
    onOpenFrameLog: jest.fn(),
    onClearFrameLog: jest.fn(),
  };
  render(<DebuggingSupportSection {...props} />);
  return props;
}

describe("DebuggingSupportSection", () => {
  describe("DebuggingSupportSection()", () => {
    afterEach(() => setInterfaceLocale("en"));

    it.each([
      [
        "en",
        "Prepare a zip from your description and selected attachments for review. You can choose whether to upload it; a GitHub issue draft may open afterward.",
      ],
      [
        "zh-CN",
        "根据您的描述和所选附件准备压缩包供检查。您可以选择是否上传，之后可能打开 GitHub 问题草稿。",
      ],
    ] as const)(
      "describes the report upload choice without promising privacy in %s",
      (locale, expected) => {
        setInterfaceLocale(locale);
        renderSection();

        expect(screen.getByText(expected)).toBeTruthy();
      }
    );

    it.each([
      [
        "en",
        true,
        "Feedback cards may appear after a problem or a failed reply. Turning this off prevents new feedback cards from failed replies and the agent. You can still choose Report an issue. Nothing is sent unless you choose to upload a report.",
      ],
      [
        "en",
        false,
        "Feedback cards may appear after a problem or a failed reply. Turning this off prevents new feedback cards from failed replies and the agent. You can still choose Report an issue. Nothing is sent unless you choose to upload a report.",
      ],
      [
        "zh-CN",
        true,
        "出现问题或回复失败时可能显示反馈卡。关闭后，回复失败和代理都不会再提供新的反馈卡。你仍可手动选择“反馈问题”。只有你选择上传报告时才会发送。",
      ],
      [
        "zh-CN",
        false,
        "出现问题或回复失败时可能显示反馈卡。关闭后，回复失败和代理都不会再提供新的反馈卡。你仍可手动选择“反馈问题”。只有你选择上传报告时才会发送。",
      ],
    ] as const)(
      "explains feedback availability and upload choice for %s with the switch set to %s",
      (locale, enabled, expected) => {
        setInterfaceLocale(locale);
        renderSection(enabled);
        expect(screen.getByText(expected)).toBeTruthy();
        expect(screen.getAllByRole("switch")[0].getAttribute("aria-checked")).toBe(String(enabled));
      }
    );

    it("renders the feedback-off gallery story with automatic and agent offers disabled and manual reporting available", () => {
      render(<DebuggingSupportSection {...storyMeta.args} {...FeedbackCardsOff.args} />);
      expect(screen.getByText(/Turning this off prevents new feedback cards/)).toBeTruthy();
      expect(screen.getAllByRole("switch")[0].getAttribute("aria-checked")).toBe("false");
    });

    const BUTTON_CALLBACKS = ["onReportIssue", "onOpenFrameLog", "onClearFrameLog"] as const;

    it.each([
      ["Report an issue", "onReportIssue"],
      ["Open", "onOpenFrameLog"],
      ["Clear", "onClearFrameLog"],
    ] as const)("hands the %s button's click to %s and to no other callback", (name, own) => {
      const props = renderSection();

      fireEvent.click(screen.getByRole("button", { name }));

      for (const callback of BUTTON_CALLBACKS) {
        expect(props[callback]).toHaveBeenCalledTimes(callback === own ? 1 : 0);
      }
    });

    it("keeps the three switches on separate callbacks", () => {
      const props = renderSection();
      const [feedbackSwitch, debugSwitch, frameLogSwitch] = screen.getAllByRole("switch");

      fireEvent.click(feedbackSwitch);

      expect(props.onOfferFeedbackCardsChange).toHaveBeenCalledWith(false);
      expect(props.onDebugChange).not.toHaveBeenCalled();
      expect(props.onFrameLogChange).not.toHaveBeenCalled();

      fireEvent.click(debugSwitch);

      expect(props.onDebugChange).toHaveBeenCalledWith(true);
      expect(props.onFrameLogChange).not.toHaveBeenCalled();

      fireEvent.click(frameLogSwitch);

      expect(props.onFrameLogChange).toHaveBeenCalledWith(false);
      expect(props.onDebugChange).toHaveBeenCalledTimes(1);
      expect(props.onOfferFeedbackCardsChange).toHaveBeenCalledTimes(1);
    });

    it("names where the activity log is written, so it can be found without this component reading the disk", () => {
      const props = renderSection();

      expect(screen.getByText(new RegExp(props.frameLogPath))).toBeTruthy();
    });

    it("does not promise that current native chats are recorded into the activity log (https://github.com/ItsDalk-Lane/Scribe/issues/22)", () => {
      renderSection();

      const description = screen
        .getAllByText(/frameLogPath|stored on this device/i)
        .map((node) => node.textContent)
        .join(" ");
      expect(description).toContain("Current native chats are not recorded");
    });
  });
});
