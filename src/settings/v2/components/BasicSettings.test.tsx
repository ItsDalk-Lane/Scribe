import { DEFAULT_SETTINGS } from "@/constants";
import { setInterfaceLocale } from "@/lib/i18n";
import { settingsAtom, settingsStore } from "@/settings/model";
import { BasicSettings } from "@/settings/v2/components/BasicSettings";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Notice } from "obsidian";
import React from "react";

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

const applyScribeRootChange = jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined);
const scribeRootContainsNotes = jest.fn<boolean, unknown[]>().mockReturnValue(false);
const findScribeRootFileConflict = jest.fn<string | null, unknown[]>().mockReturnValue(null);
jest.mock("@/settings/scribeRootChange", () => ({
  applyScribeRootChange: (...a: unknown[]) => applyScribeRootChange(...a),
  scribeRootContainsNotes: (...a: unknown[]) => scribeRootContainsNotes(...a),
  findScribeRootFileConflict: (...a: unknown[]) => findScribeRootFileConflict(...a),
}));

let capturedOnConfirm: (() => void) | null = null;
let capturedConfirmButtonText = "";
const modalCtor = jest.fn((onConfirm: () => void, confirmButtonText: string) => {
  capturedOnConfirm = onConfirm;
  capturedConfirmButtonText = confirmButtonText;
});
jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: class {
    open = jest.fn();
    constructor(
      _app: unknown,
      onConfirm: () => void,
      _content: unknown,
      _title: string,
      confirmButtonText: string
    ) {
      modalCtor(onConfirm, confirmButtonText);
    }
  },
}));

describe("BasicSettings", () => {
  describe("BasicSettings", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      capturedOnConfirm = null;
      capturedConfirmButtonText = "";
      settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, scribeFolder: "scribe" });
      scribeRootContainsNotes.mockReturnValue(false);
      findScribeRootFileConflict.mockReturnValue(null);
    });

    afterEach(() => setInterfaceLocale("en"));

    it("shows the general settings and the vault instructions in one panel", () => {
      render(<BasicSettings />);

      expect(screen.getByLabelText("Scribe folder")).toBeTruthy();
      expect(screen.getByText("Custom instructions")).toBeTruthy();
      expect(screen.queryByText("Autosave chats as Markdown")).toBeNull();
    });

    it("turns off active-note auto-attach from its switch", () => {
      render(<BasicSettings />);

      const row = screen.getByText("Auto-attach active note").parentElement!.parentElement!;
      fireEvent.click(within(row).getByRole("switch"));

      expect(settingsStore.get(settingsAtom).autoAttachActiveNote).toBe(false);
    });

    it("binds the Scribe folder input to the persisted root", () => {
      render(<BasicSettings />);
      expect(screen.getByLabelText<HTMLInputElement>("Scribe folder").value).toBe("scribe");
    });

    it("rejects an invalid root on Apply without opening the confirm modal", () => {
      render(<BasicSettings />);
      fireEvent.change(screen.getByLabelText("Scribe folder"), { target: { value: "../escape" } });
      fireEvent.click(screen.getByRole("button", { name: "Apply Scribe folder" }));
      expect(Notice).toHaveBeenCalledTimes(1);
      expect(modalCtor).not.toHaveBeenCalled();
      expect(applyScribeRootChange).not.toHaveBeenCalled();
    });

    it("rejects a root inside the vault's active config directory", () => {
      render(<BasicSettings />);
      fireEvent.change(screen.getByLabelText("Scribe folder"), {
        target: { value: ".vault-config/plugins" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Apply Scribe folder" }));

      expect(Notice).toHaveBeenCalledTimes(1);
      expect(modalCtor).not.toHaveBeenCalled();
      expect(applyScribeRootChange).not.toHaveBeenCalled();
    });

    it("rejects a root whose path is occupied by an existing file without opening the confirm modal", () => {
      findScribeRootFileConflict.mockReturnValue("ai.txt");
      render(<BasicSettings />);
      fireEvent.change(screen.getByLabelText("Scribe folder"), { target: { value: "ai.txt" } });
      fireEvent.click(screen.getByRole("button", { name: "Apply Scribe folder" }));
      expect(Notice).toHaveBeenCalledTimes(1);
      expect(modalCtor).not.toHaveBeenCalled();
      expect(applyScribeRootChange).not.toHaveBeenCalled();
    });

    it("opens a warning confirmation for a root that already contains Markdown", () => {
      scribeRootContainsNotes.mockReturnValue(true);
      render(<BasicSettings />);
      fireEvent.change(screen.getByLabelText("Scribe folder"), { target: { value: "existing" } });
      fireEvent.click(screen.getByRole("button", { name: "Apply Scribe folder" }));

      expect(modalCtor).toHaveBeenCalledTimes(1);
      expect(capturedConfirmButtonText).toBe("Use folder");
      expect(applyScribeRootChange).not.toHaveBeenCalled();

      capturedOnConfirm?.();
      expect(applyScribeRootChange).toHaveBeenCalledWith(expect.anything(), "existing");
    });

    it("still warns when the non-empty folder is a previously used Scribe root", () => {
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        scribeFolder: "scribe",
        scribeRootHistory: ["scribe", "old-root"],
      });
      scribeRootContainsNotes.mockReturnValue(true);
      render(<BasicSettings />);
      fireEvent.change(screen.getByLabelText("Scribe folder"), { target: { value: "old-root" } });
      fireEvent.click(screen.getByRole("button", { name: "Apply Scribe folder" }));

      expect(scribeRootContainsNotes).toHaveBeenCalledWith(expect.anything(), "old-root");
      expect(modalCtor).toHaveBeenCalledTimes(1);
      expect(capturedConfirmButtonText).toBe("Use folder");
    });

    it("opens the confirm modal for a valid new root and applies the change on confirm", () => {
      render(<BasicSettings />);
      fireEvent.change(screen.getByLabelText("Scribe folder"), { target: { value: "ai" } });
      fireEvent.click(screen.getByRole("button", { name: "Apply Scribe folder" }));
      expect(modalCtor).toHaveBeenCalledTimes(1);
      expect(capturedConfirmButtonText).toBe("Change folder");
      expect(applyScribeRootChange).not.toHaveBeenCalled();

      capturedOnConfirm?.();
      expect(applyScribeRootChange).toHaveBeenCalledWith(expect.anything(), "ai");
    });

    it("does nothing when Apply is pressed with the current root unchanged", () => {
      render(<BasicSettings />);
      fireEvent.click(screen.getByRole("button", { name: "Apply Scribe folder" }));
      expect(modalCtor).not.toHaveBeenCalled();
      expect(applyScribeRootChange).not.toHaveBeenCalled();
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
