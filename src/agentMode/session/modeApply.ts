import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { ModeApplySpec } from "@/agentMode/session/types";

export async function applyModeSpec(
  session: Pick<AgentSession, "setMode" | "setConfigOption">,
  spec: ModeApplySpec
): Promise<void> {
  const steps = spec.kind === "sequence" ? spec.steps : [spec];
  for (const step of steps) {
    if (step.kind === "setMode") {
      await session.setMode(step.nativeId);
    } else {
      await session.setConfigOption(step.configId, step.value);
    }
  }
}
