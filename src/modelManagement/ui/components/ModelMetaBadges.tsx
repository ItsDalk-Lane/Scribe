import { t } from "@/lib/i18n";
import type { ModelInfo, ModelStatus } from "@/modelManagement/types/catalog";
import { Badge } from "@/components/ui/badge";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { AudioLines, CircleAlert, FileText, FlaskConical, Image, Video } from "lucide-react";
import React from "react";

const STATUS_LABELS: Record<ModelStatus, string> = {
  deprecated: "Deprecated",
  beta: "Beta",
  alpha: "Alpha",
};

export const ModelStatusBadge: React.FC<{ status?: ModelStatus }> = ({ status }) => {
  if (!status) return null;
  if (status === "deprecated") {
    return (
      <Badge variant="destructive" className="tw-shrink-0 tw-gap-1 tw-text-ui-smaller">
        <CircleAlert className="tw-size-3" aria-hidden="true" />
        {t("Deprecated")}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="tw-shrink-0 tw-gap-1 tw-text-ui-smaller">
      {status === "beta" ? <FlaskConical className="tw-size-3" aria-hidden="true" /> : null}
      {t(STATUS_LABELS[status])}
    </Badge>
  );
};

// text 模态所有聊天模型都具备，不重复展示；仅声明了输入模态清单的模型显示图形标签。https://github.com/ItsDalk-Lane/Scribe/issues/67
const INPUT_MODALITY_ICONS = [
  { modality: "image", Icon: Image, label: "Supports image inputs" },
  { modality: "pdf", Icon: FileText, label: "Supports PDF inputs" },
  { modality: "video", Icon: Video, label: "Supports video inputs" },
  { modality: "audio", Icon: AudioLines, label: "Supports audio inputs" },
] as const;

export const ModelModalityIcons: React.FC<{ info: ModelInfo; iconSize?: number }> = ({
  info,
  iconSize = 14,
}) => {
  const input = info.modalities?.input;
  if (!input || input.length === 0) return null;
  const declared = INPUT_MODALITY_ICONS.filter((entry) => input.includes(entry.modality));
  if (declared.length === 0) return null;
  return (
    <span className="tw-inline-flex tw-shrink-0 tw-items-center tw-gap-0.5">
      {declared.map(({ modality, Icon, label }) => (
        <HelpTooltip key={modality} content={t(label)} side="top">
          <Icon
            className="tw-text-muted"
            style={{ width: iconSize, height: iconSize }}
            data-testid={`model-modality-${modality}`}
            aria-label={t(label)}
          />
        </HelpTooltip>
      ))}
    </span>
  );
};
