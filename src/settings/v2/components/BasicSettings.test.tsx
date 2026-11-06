import { DEFAULT_SETTINGS } from "@/constants";
import { setInterfaceLocale } from "@/lib/i18n";
import { settingsAtom, settingsStore } from "@/settings/model";
import { BasicSettings } from "@/settings/v2/components/BasicSettings";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { Notice } from "obsidian";

const mockCloseSettings = jest.fn<void, []>();
jest.mock("@/context", () => {
  const app = {
    vault: { configDir: ".vault-config", getMarkdownFiles: () => [] },
    setting: { close: () => mockCloseSettings() },
  };
  return {
    // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
    useApp: () => app,
  };
});

const openAgentsFile = jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined);
const readAgentsFile = jest.fn<Promise<string>, unknown[]>().mockResolvedValue("");
const writeAgentsFile = jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined);
jest.mock("@/instructions/agentsFile", () => ({
  openAgentsFile: (...a: unknown[]): Promise<void> => openAgentsFile(...a),
  readAgentsFile: (...a: unknown[]): Promise<string> => readAgentsFile(...a),
  writeAgentsFile: (...a: unknown[]): Promise<void> => writeAgentsFile(...a),
}));

const mockClearDeviceUnlock = jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined);
jest.mock("@/services/deviceUnlockStore", () => ({
  clearDeviceUnlock: (...a: unknown[]): Promise<void> => mockClearDeviceUnlock(...a),
}));

describe("BasicSettings", () => {
  describe("BasicSettings", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, scribeFolder: "scribe" });
    });

    afterEach(() => setInterfaceLocale("en"));

    it("shows the general settings and the vault instructions without section headings", () => {
      render(<BasicSettings />);

      expect(screen.queryByLabelText("Scribe folder")).toBeNull();
      expect(screen.queryByText("General")).toBeNull();
      expect(screen.queryByText("Custom instructions")).toBeNull();
      expect(screen.queryByText("Autosave chats as Markdown")).toBeNull();
    });

    it("turns off active-note auto-attach from its switch", () => {
      render(<BasicSettings />);

      const row = screen.getByText("Auto-attach active note").parentElement!.parentElement!;
      fireEvent.click(within(row).getByRole("switch"));

      expect(settingsStore.get(settingsAtom).autoAttachActiveNote).toBe(false);
    });

    it("turns off device master-password remembering and drops the stored unlock (https://github.com/ItsDalk-Lane/Scribe/issues/37)", () => {
      render(<BasicSettings />);

      const row = screen.getByText("Remember the master password on this device").parentElement!
        .parentElement!;
      fireEvent.click(within(row).getByRole("switch"));

      expect(settingsStore.get(settingsAtom).secretsRememberOnDevice).toBe(false);
      expect(mockClearDeviceUnlock).toHaveBeenCalledTimes(1);
    });

    it("keeps the draft open after a failed save and retries it before opening the file", async () => {
      writeAgentsFile.mockRejectedValueOnce(new Error("disk unavailable"));
      render(<BasicSettings />);
      const editor = await screen.findByRole("textbox", { name: "Custom vault instructions" });
      fireEvent.change(editor, { target: { value: "Unsaved rules" } });
      fireEvent.click(screen.getByRole("button", { name: /Open AGENTS.md/ }));
      await waitFor(() => expect(Notice).toHaveBeenCalled());
      expect(openAgentsFile).not.toHaveBeenCalled();
      expect(mockCloseSettings).not.toHaveBeenCalled();
      expect((editor as HTMLTextAreaElement).value).toBe("Unsaved rules");
      fireEvent.click(screen.getByRole("button", { name: /Open AGENTS.md/ }));
      await waitFor(() => expect(openAgentsFile).toHaveBeenCalledTimes(1));
      expect(writeAgentsFile).toHaveBeenCalledTimes(2);
      expect(mockCloseSettings).toHaveBeenCalledTimes(1);
    });

    it("opens a blank vault AGENTS.md, never seeded from a Chat prompt", async () => {
      render(<BasicSettings />);
      fireEvent.click(await screen.findByRole("button", { name: /Open AGENTS.md/ }));
      await waitFor(() => expect(openAgentsFile).toHaveBeenCalledWith(expect.anything(), ""));
      expect(writeAgentsFile).not.toHaveBeenCalled();
    });

    it("lands a pending edit before opening the file, so the open cannot race the save", async () => {
      render(<BasicSettings />);
      const editor = await screen.findByRole("textbox", { name: "Custom vault instructions" });
      fireEvent.change(editor, { target: { value: "Always cite." } });

      fireEvent.click(screen.getByRole("button", { name: /Open AGENTS.md/ }));

      await waitFor(() => expect(openAgentsFile).toHaveBeenCalledWith(expect.anything(), ""));
      expect(writeAgentsFile).toHaveBeenCalledWith(expect.anything(), "", "Always cite.");
      expect(writeAgentsFile.mock.invocationCallOrder[0]).toBeLessThan(
        openAgentsFile.mock.invocationCallOrder[0]
      );
    });

    it("shows what the vault AGENTS.md already says, so editing starts from the real file", async () => {
      readAgentsFile.mockResolvedValue("Cite every source.");
      render(<BasicSettings />);
      const editor = await screen.findByRole<HTMLTextAreaElement>("textbox", {
        name: "Custom vault instructions",
      });
      expect(editor.value).toBe("Cite every source.");
      expect(readAgentsFile).toHaveBeenCalledWith(expect.anything(), "");
    });

    it("saves an edit back to the vault AGENTS.md once typing settles", async () => {
      jest.useFakeTimers();
      try {
        render(<BasicSettings />);
        const editor = await screen.findByRole("textbox", { name: "Custom vault instructions" });
        fireEvent.change(editor, { target: { value: "Always cite." } });

        expect(writeAgentsFile).not.toHaveBeenCalled();
        await act(async () => {
          jest.advanceTimersByTime(1000);
        });

        expect(writeAgentsFile).toHaveBeenCalledWith(expect.anything(), "", "Always cite.");
      } finally {
        jest.useRealTimers();
      }
    });

    it("queues instruction writes so a slow save cannot land after — and overwrite — a newer one", async () => {
      jest.useFakeTimers();
      try {
        let settleFirst!: () => void;
        writeAgentsFile.mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              settleFirst = resolve;
            })
        );
        render(<BasicSettings />);
        const editor = await screen.findByRole("textbox", { name: "Custom vault instructions" });

        fireEvent.change(editor, { target: { value: "First" } });
        await act(async () => {
          jest.advanceTimersByTime(1000);
        });
        expect(writeAgentsFile).toHaveBeenCalledTimes(1);

        fireEvent.change(editor, { target: { value: "Second" } });
        await act(async () => {
          jest.advanceTimersByTime(1000);
        });
        expect(writeAgentsFile).toHaveBeenCalledTimes(1);

        settleFirst();
        await act(async () => {
          await Promise.resolve();
        });

        expect(writeAgentsFile).toHaveBeenCalledTimes(2);
        expect(writeAgentsFile).toHaveBeenLastCalledWith(expect.anything(), "", "Second");
      } finally {
        jest.useRealTimers();
      }
    });

    it("does not lose a pending edit when the tab closes mid-sentence", async () => {
      jest.useFakeTimers();
      try {
        const { unmount } = render(<BasicSettings />);
        const editor = await screen.findByRole("textbox", { name: "Custom vault instructions" });
        fireEvent.change(editor, { target: { value: "Half a thou" } });
        unmount();
        await act(async () => {
          await Promise.resolve();
        });

        expect(writeAgentsFile).toHaveBeenCalledWith(expect.anything(), "", "Half a thou");
      } finally {
        jest.useRealTimers();
      }
    });

    it("keeps vault instructions without showing the retired chat-prompt notice", async () => {
      render(<BasicSettings />);
      expect(await screen.findByRole("button", { name: /Open AGENTS.md/ })).toBeTruthy();
      expect(screen.queryByText(/saved system prompt/)).toBeNull();
    });
  });
});
