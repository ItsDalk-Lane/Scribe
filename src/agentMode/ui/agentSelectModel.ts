import { t } from "@/lib/i18n";
import type { BackendDescriptor, BackendId, InstallState } from "@/agentMode/session/types";

export type AgentSelectStatus =
  | "checking"
  | "installed"
  | "outdated"
  | "absent"
  | "error"
  | "signed-out";

export interface AgentSelectRow {
  id: BackendId;
  name: string;
  description: string;
  status: AgentSelectStatus;
  recommended: boolean;
  statusMessage: string | null;
  usesConfiguredModels: boolean;
}

export type AgentSelectAction = "start" | "configure" | "wait";

export interface AgentSelectCta {
  label: string;
  note: string | null;
  action: AgentSelectAction;
}

const EMPTY_AGENT_SELECT_ROWS: readonly AgentSelectRow[] = Object.freeze([]);

function toSelectStatus(kind: InstallState["kind"]): AgentSelectStatus {
  switch (kind) {
    case "ready":
      return "installed";
    case "checking":
      return "checking";
    case "incompatible":
      return "outdated";
    case "error":
      return "error";
    case "absent":
      return "absent";
  }
}

function statusMessageOf(state: InstallState): string | null {
  return state.kind === "incompatible" || state.kind === "error" ? state.message : null;
}

export function buildAgentSelectRows(
  descriptors: readonly BackendDescriptor[],
  states: Partial<Record<BackendId, InstallState>>,
  recommendedId: BackendId
): readonly AgentSelectRow[] {
  if (descriptors.length === 0) return EMPTY_AGENT_SELECT_ROWS;
  return descriptors.map((descriptor) => {
    const state = states[descriptor.id] ?? { kind: "absent" as const };
    return {
      id: descriptor.id,
      name: descriptor.displayName,
      description: t(descriptor.setupDescription),
      status: toSelectStatus(state.kind),
      recommended: descriptor.id === recommendedId,
      statusMessage: statusMessageOf(state),
      usesConfiguredModels: descriptor.usesConfiguredModels ?? false,
    };
  });
}

export function resolveAgentSelectCta(row: AgentSelectRow): AgentSelectCta {
  if (row.status === "checking") {
    return {
      label: t("Checking…"),
      note: t("Checking {p0} setup…", { p0: row.name }),
      action: "wait",
    };
  }
  if (row.status === "installed") {
    return { label: t("Start chat"), note: null, action: "start" };
  }
  // 配置驱动型后端（如原生 Scribe）不存在"本机未安装"，缺的是已启用的模型。
  // https://github.com/ItsDalk-Lane/Scribe/issues/21
  if (row.status === "absent" && row.usesConfiguredModels) {
    return {
      label: t("Configure"),
      note: t("No chat model is enabled for {p0} yet. Add a provider and enable a model first.", {
        p0: row.name,
      }),
      action: "configure",
    };
  }
  return {
    label: t("Configure"),
    note: row.statusMessage ?? t("{p0} isn't set up on this machine yet.", { p0: row.name }),
    action: "configure",
  };
}
