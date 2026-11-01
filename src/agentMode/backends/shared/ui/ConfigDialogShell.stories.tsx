import {
  ConfigDialogShell,
  ConfigSection,
  ConfigWarningStrip,
} from "@/agentMode/backends/shared/ui/ConfigDialogShell";
import type { InstallState } from "@/agentMode/session/types";
import { FULL_BLEED_MODAL_CLASS } from "@/components/modals/ReactModal";
import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";

type ConfigDialogShellProps = React.ComponentProps<typeof ConfigDialogShell>;

const CLAUDE_OUTDATED: InstallState = {
  kind: "incompatible",
  source: "custom",
  currentVersion: "2.1.205",
  minVersion: "2.1.206",
  message: "Claude 2.1.205 is not supported. Scribe requires 2.1.206 or newer.",
};

const CLAUDE_ERROR: InstallState = {
  kind: "error",
  message: "Could not read /usr/local/bin/claude.",
};

const UPDATE_HINT = "Update it with the install command below, then reopen this dialog.";

const BODY = (
  <>
    <ConfigSection title="First section">
      <p className="tw-my-0 tw-text-sm tw-text-muted">
        Placeholder body. Agents fill their sections with their own controls; the shell only
        guarantees the band's padding and the hairline above it.
      </p>
    </ConfigSection>
    <ConfigSection title="Second section">
      <p className="tw-my-0 tw-text-sm tw-text-muted">
        A second band shows the divider between neighbours, which should reach both edges of the
        modal rather than stopping short of them.
      </p>
    </ConfigSection>
  </>
);

const meta = {
  title: "Agent Mode/Config Dialog Shell",
  component: ConfigDialogShell,
  args: {
    title: "Configure Claude",
    state: { kind: "absent" },
    children: BODY,
    onClose: () => undefined,
  },
  parameters: {
    gallery: { host: "modal", layout: "padded", modalClass: FULL_BLEED_MODAL_CLASS },
  },
} satisfies Meta<ConfigDialogShellProps>;
export default meta;

export const NotSetUp: StoryObj<ConfigDialogShellProps> = {};

export const Ready: StoryObj<ConfigDialogShellProps> = {
  args: { state: { kind: "ready", source: "managed" } },
};

export const UpdateRequiredCommandOnly: StoryObj<ConfigDialogShellProps> = {
  args: {
    title: "Configure Claude",
    state: CLAUDE_OUTDATED,
    warning: <ConfigWarningStrip state={CLAUDE_OUTDATED} detail={UPDATE_HINT} />,
  },
};

export const ErrorState: StoryObj<ConfigDialogShellProps> = {
  args: {
    title: "Configure Claude",
    state: CLAUDE_ERROR,
    warning: <ConfigWarningStrip state={CLAUDE_ERROR} />,
  },
};
