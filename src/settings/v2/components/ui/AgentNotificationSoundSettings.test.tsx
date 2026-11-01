import { setInterfaceLocale } from "@/lib/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { AgentNotificationSoundSettings } from "./AgentNotificationSoundSettings";

const SOUND_OPTIONS = [
  { label: "Piano key", value: "piano" },
  { label: "Doorbell", value: "doorbell" },
];

describe("AgentNotificationSoundSettings", () => {
  describe("AgentNotificationSoundSettings()", () => {
    afterEach(() => setInterfaceLocale("en"));

    it("shows Chinese sound names while preserving the selected sound id", () => {
      setInterfaceLocale("zh-CN");
      const onSoundChange = jest.fn();
      render(
        <AgentNotificationSoundSettings
          enabled
          onEnabledChange={() => undefined}
          onSoundChange={onSoundChange}
          soundId="piano"
          soundOptions={SOUND_OPTIONS}
        />
      );
      expect(screen.getByText("通知")).not.toBeNull();
      fireEvent.change(screen.getByDisplayValue("钢琴"), { target: { value: "doorbell" } });
      expect(screen.getByRole("option", { name: "门铃" })).not.toBeNull();
      expect(onSoundChange).toHaveBeenCalledWith("doorbell");
    });

    it("shows the sound picker while notifications are enabled (https://github.com/logancyang/obsidian-copilot/issues/2987)", () => {
      render(
        <AgentNotificationSoundSettings
          enabled
          onEnabledChange={() => undefined}
          onSoundChange={() => undefined}
          soundId="piano"
          soundOptions={SOUND_OPTIONS}
        />
      );

      expect(screen.getByText("Notification")).not.toBeNull();
      expect(screen.getByText("Plays a short sound when an agent finishes a turn.")).not.toBeNull();
      expect(screen.getByText("Choose which sound to play.")).not.toBeNull();
      expect(screen.getByDisplayValue("Piano key")).not.toBeNull();
    });

    it("hides the sound picker while notifications are disabled (https://github.com/logancyang/obsidian-copilot/issues/2987)", () => {
      render(
        <AgentNotificationSoundSettings
          enabled={false}
          onEnabledChange={() => undefined}
          onSoundChange={() => undefined}
          soundId="piano"
          soundOptions={SOUND_OPTIONS}
        />
      );

      expect(screen.getByText("Notification")).not.toBeNull();
      expect(screen.queryByText("Sound")).toBeNull();
    });

    it("reports toggle and picker changes to its host", () => {
      const onEnabledChange = jest.fn();
      const onSoundChange = jest.fn();
      render(
        <AgentNotificationSoundSettings
          enabled
          onEnabledChange={onEnabledChange}
          onSoundChange={onSoundChange}
          soundId="piano"
          soundOptions={SOUND_OPTIONS}
        />
      );

      fireEvent.click(screen.getByRole("switch"));
      fireEvent.change(screen.getByDisplayValue("Piano key"), {
        target: { value: "doorbell" },
      });

      expect(onEnabledChange).toHaveBeenCalledWith(false);
      expect(onSoundChange).toHaveBeenCalledWith("doorbell");
    });
  });
});
