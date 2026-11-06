import React from "react";
import type { SkillDependency } from "@/agentMode/skills/skillFormat";
import {
  checkSkillDependencies,
  clearSkillDependencyCache,
  type SkillDependencyCheckProbes,
  type SkillDependencyReading,
} from "@/agentMode/skills/skillDependencyCheck";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { RefreshCw } from "lucide-react";

export interface SkillDependencyPanelProps {
  dependencies: readonly SkillDependency[];
  probes?: SkillDependencyCheckProbes;
}

// 详情页就绪面板：本地只读检测逐项呈现已就绪/未就绪与安装指引，绝不自动安装。
// https://github.com/ItsDalk-Lane/Scribe/issues/46
export function SkillDependencyPanel({ dependencies, probes }: SkillDependencyPanelProps) {
  const [readings, setReadings] = React.useState<SkillDependencyReading[] | null>(null);
  const load = React.useCallback(
    async (fresh: boolean) => {
      setReadings(await checkSkillDependencies(dependencies, probes, fresh));
    },
    [dependencies, probes]
  );
  React.useEffect(() => {
    void load(false);
  }, [load]);
  if (!dependencies.length) return null;
  return (
    <section aria-label={t("Skill dependencies")} className="tw-space-y-2">
      <div className="tw-flex tw-items-center tw-justify-between">
        <h4 className="tw-m-0 tw-text-ui-small tw-font-medium">{t("Skill dependencies")}</h4>
        <Button
          variant="secondary"
          onClick={() => {
            clearSkillDependencyCache();
            void load(true);
          }}
        >
          <RefreshCw className="tw-size-4" />
          {t("Recheck dependencies")}
        </Button>
      </div>
      <ul className="tw-m-0 tw-list-none tw-space-y-1 tw-p-0">
        {(readings ?? []).map((reading) => (
          <li
            key={`${reading.type}:${reading.name}`}
            className="tw-flex tw-items-baseline tw-gap-2"
          >
            <span
              aria-label={reading.ready ? t("Ready") : t("Not ready")}
              className={
                reading.ready
                  ? "tw-inline-block tw-size-2 tw-shrink-0 tw-rounded-full tw-bg-success"
                  : "tw-inline-block tw-size-2 tw-shrink-0 tw-rounded-full tw-bg-error"
              }
            />
            <span className="tw-min-w-0">
              <strong>{reading.name}</strong>{" "}
              <span className="tw-text-ui-smaller tw-text-muted">({reading.detail})</span>
              {!reading.ready && (
                <span className="tw-text-ui-smaller tw-text-muted">
                  {" "}
                  {t(
                    {
                      command: "Install this command-line tool yourself before using the skill.",
                      "obsidian-plugin":
                        "Install this community plugin from Obsidian settings yourself.",
                      "python-package":
                        "Install this Python package yourself before using the skill.",
                    }[reading.type]
                  )}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {readings === null && <p role="status">{t("Checking dependencies…")}</p>}
    </section>
  );
}
