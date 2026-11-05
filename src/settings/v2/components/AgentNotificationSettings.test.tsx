import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { AgentNotificationSettings } from "./AgentNotificationSettings";
import { getSettings, resetSettings } from "@/settings/model";
import { playNotificationSound } from "@/utils/notificationSound";
import { NOTIFICATION_SOUND_OPTIONS } from "@/utils/notificationSoundCatalog";

jest.mock("@/utils/notificationSound", () => ({ playNotificationSound: jest.fn() }));

describe("AgentNotificationSettings", () => {
  describe("AgentNotificationSettings()", () => {
    beforeEach(() => resetSettings());
    it("saves notification choices from General without changing the existing stored preferences https://github.com/ItsDalk-Lane/Scribe/issues/31", () => {
      render(<AgentNotificationSettings />);
      const enabled = getSettings().agentMode.notificationSound;
      const toggle = screen.getByRole("switch");
      if (enabled) fireEvent.click(toggle);
      expect(screen.queryByRole("combobox")).toBeNull();
      fireEvent.click(toggle);
      const value = NOTIFICATION_SOUND_OPTIONS[1].value;
      fireEvent.change(screen.getByRole("combobox"), { target: { value } });
      expect(getSettings().agentMode.notificationSound).toBe(true);
      expect(getSettings().agentMode.notificationSoundId).toBe(value);
      expect(playNotificationSound).toHaveBeenCalledWith(value);
    });
  });
});
