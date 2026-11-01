import { t } from "@/lib/i18n";
import type { TurnFileChange } from "@/agentMode/session/types";
import {
  ChangeScroller,
  useChangeNavigation,
  type ChangeStep,
} from "@/agentMode/ui/renderedDiff/ChangeScroller";
import { RenderedDiff } from "@/agentMode/ui/renderedDiff/RenderedDiff";
import { TurnDiffHeader } from "@/agentMode/ui/TurnDiffHeader";
import { COMMAND_IDS, COMMAND_NAMES, TURN_DIFF_VIEW_TYPE } from "@/constants";
import { useApp } from "@/context";
import { logError } from "@/logger";
import { openFileInTab, type OpenPane } from "@/utils/openVaultPath";
import {
  AgentDetailModal,
  activeAgentDetailModal,
  openAgentDetailModal,
} from "@/agentMode/ui/AgentDetailModal";
import { App, Notice, Plugin, TFile, Workspace } from "obsidian";
import React from "react";

export function closeRestoredTurnDiffs(workspace: Workspace): void {
  workspace.onLayoutReady(() => {
    workspace.detachLeavesOfType(TURN_DIFF_VIEW_TYPE);
    workspace.detachLeavesOfType("scribe-task-detail-view");
  });
}

export function registerTurnDiffCommands(plugin: Plugin): void {
  const steps = [
    [COMMAND_IDS.NEXT_DIFF_CHANGE, 1],
    [COMMAND_IDS.PREVIOUS_DIFF_CHANGE, -1],
  ] as const;
  for (const [id, direction] of steps) {
    plugin.addCommand({
      id,
      name: t(COMMAND_NAMES[id]),
      repeatable: true,
      checkCallback: (checking) => {
        const modal = activeAgentDetailModal(plugin.app);
        return modal instanceof TurnDiffModal ? modal.stepChange(direction, checking) : false;
      },
    });
  }
}

export interface TurnDiffState extends TurnFileChange {
  turnId: string;
}

export class TurnDiffModal extends AgentDetailModal {
  private stepper: ((direction: ChangeStep) => void) | null = null;

  constructor(
    app: App,
    private readonly state: TurnDiffState
  ) {
    super(
      app,
      turnDiffKey(state.turnId, state.path),
      state.path.slice(state.path.lastIndexOf("/") + 1)
    );
  }

  stepChange(direction: ChangeStep, checking: boolean): boolean {
    if (!this.stepper) return false;
    if (!checking) this.stepper(direction);
    return true;
  }

  protected renderContent(): React.ReactElement {
    return <TurnDiffPane state={this.state} onStepperChange={this.setStepper} />;
  }

  private readonly setStepper = (stepper: ((direction: ChangeStep) => void) | null): void => {
    this.stepper = stepper;
  };
}

export interface TurnDiffPaneProps {
  state: TurnDiffState;
  onStepperChange: (stepper: ((direction: ChangeStep) => void) | null) => void;
}

export const TurnDiffPane: React.FC<TurnDiffPaneProps> = ({ state, onStepperChange }) => {
  const app = useApp();
  const navigation = useChangeNavigation();
  const total = navigation.layout.ticks.length;
  React.useEffect(() => {
    onStepperChange(total > 0 ? navigation.step : null);
    return () => onStepperChange(null);
  }, [onStepperChange, navigation.step, total]);
  return (
    <div className="tw-flex tw-h-full tw-flex-col">
      <TurnDiffHeader
        path={state.path}
        status={state.status}
        additions={state.additions}
        deletions={state.deletions}
        changes={{ current: navigation.current, total, onStep: navigation.step }}
        onOpenNote={
          state.status === "deleted" ? undefined : (pane) => openNote(app, state.path, pane)
        }
      />
      <ChangeScroller navigation={navigation}>
        <RenderedDiff before={state.before} after={state.after} path={state.path} />
      </ChangeScroller>
    </div>
  );
};

export async function openTurnDiff(
  app: App,
  change: TurnFileChange,
  turnId: string
): Promise<TurnDiffModal> {
  const state: TurnDiffState = { ...change, turnId };
  return openAgentDetailModal(
    app,
    turnDiffKey(turnId, change.path),
    () => new TurnDiffModal(app, state)
  );
}

function turnDiffKey(turnId: string, path: string): string {
  return `diff:${turnId}\n${path}`;
}

function openNote(app: App, path: string, pane: OpenPane): void {
  const file = app.vault.getAbstractFileByPath(path);
  // Opening a path whose file was renamed or deleted after the turn would create an empty note.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
  if (!(file instanceof TFile)) {
    new Notice(t("{p0} no longer exists.", { p0: path }));
    return;
  }
  void openFileInTab(app, file, pane).catch((error: unknown) =>
    logError("[TurnDiffView] failed to open the note", error)
  );
}
