import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import { SettingSwitch } from "@/components/ui/setting-switch";
import React from "react";

export interface DebuggingSupportSectionProps {
  debug: boolean;
  onDebugChange: (checked: boolean) => void;
  frameLogEnabled: boolean;
  onFrameLogChange: (checked: boolean) => void;
  frameLogPath: string;
  onReportIssue: () => void;
  offerFeedbackCards: boolean;
  onOfferFeedbackCardsChange: (checked: boolean) => void;
  onOpenFrameLog: React.MouseEventHandler<HTMLButtonElement>;
  onClearFrameLog: React.MouseEventHandler<HTMLButtonElement>;
}

export const DebuggingSupportSection: React.FC<DebuggingSupportSectionProps> = ({
  debug,
  onDebugChange,
  frameLogEnabled,
  onFrameLogChange,
  frameLogPath,
  onReportIssue,
  offerFeedbackCards,
  onOfferFeedbackCardsChange,
  onOpenFrameLog,
  onClearFrameLog,
}) => (
  <SettingSection label={t("Debugging & support")}>
    <SettingItem
      type="custom"
      title={t("Report an issue")}
      description={t(
        "Walks you through collecting a screenshot and recent logs, packs them into a single zip you can review, uploads it privately, and opens a prefilled GitHub issue with the report ID already in it."
      )}
    >
      <Button variant="default" size="sm" onClick={onReportIssue}>
        {t("Report an issue")}
      </Button>
    </SettingItem>

    <SettingItem
      type="switch"
      title={t("Offer feedback reports in Agent Chat")}
      description={t(
        "When something goes wrong in Agent Chat, or a reply fails with an error, Scribe drafts a report for you to review. Nothing is sent unless you press Report."
      )}
      checked={offerFeedbackCards}
      onCheckedChange={onOfferFeedbackCardsChange}
    />

    <SettingItem
      type="switch"
      title={t("Debug mode")}
      description={t(
        "Logs Scribe chat activity to the developer console (View → Toggle Developer Tools), and pre-selects the chat log when you report an issue."
      )}
      checked={debug}
      onCheckedChange={onDebugChange}
    />

    <SettingItem
      type="custom"
      title={t("Agent activity log")}
      description={t(
        // 原生代理不写入活动日志；如实描述这里只有旧版本记录的内容。
        // https://github.com/ItsDalk-Lane/Scribe/issues/22
        "Holds the behind-the-scenes activity that earlier Scribe versions recorded. Current native chats are not recorded. Stored on this device only, outside your vault ({frameLogPath}), and can include your prompts and note contents in plain text.",
        { frameLogPath: frameLogPath }
      )}
    >
      <div className="tw-flex tw-items-center tw-gap-2">
        <SettingSwitch checked={frameLogEnabled} onCheckedChange={onFrameLogChange} />
        <Button variant="secondary" size="sm" onClick={onOpenFrameLog}>
          {t("Open")}
        </Button>
        <Button variant="secondary" size="sm" onClick={onClearFrameLog}>
          {t("Clear")}
        </Button>
      </div>
    </SettingItem>
  </SettingSection>
);
