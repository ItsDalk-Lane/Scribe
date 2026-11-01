import { t } from "@/lib/i18n";
import React from "react";
import type { CustomModel } from "@/aiParams";
import { EyeOff } from "lucide-react";
import { ModelCapability } from "@/constants";
import { HelpTooltip } from "@/components/ui/help-tooltip";

interface ModelDisplayProps {
  model: CustomModel;
  iconSize?: number;
}

interface ModelCapabilityIconsProps {
  capabilities?: ModelCapability[];
  iconSize?: number;
}

const NO_VISION_LABEL = "This model does not support image inputs.";

export function hasCapabilityIcons(capabilities: ModelCapability[] | undefined): boolean {
  if (capabilities === undefined) return false;
  return !capabilities.includes(ModelCapability.VISION);
}

export const ModelCapabilityIcons: React.FC<ModelCapabilityIconsProps> = ({
  capabilities,
  iconSize = 16,
}) => {
  if (capabilities === undefined) return null;
  if (capabilities.includes(ModelCapability.VISION)) return null;
  return (
    <HelpTooltip content={t(NO_VISION_LABEL)} side="top">
      <EyeOff
        className="tw-text-muted"
        style={{ width: iconSize, height: iconSize }}
        data-testid="model-cap-no-vision"
      />
    </HelpTooltip>
  );
};

export const ModelDisplay: React.FC<ModelDisplayProps> = ({ model, iconSize = 14 }) => {
  const displayName = model.displayName || model.name;
  return (
    <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-1">
      <span className="tw-truncate tw-text-sm hover:tw-text-normal">{displayName}</span>
      {hasCapabilityIcons(model.capabilities) && (
        <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-0.5">
          <ModelCapabilityIcons capabilities={model.capabilities} iconSize={iconSize} />
        </div>
      )}
    </div>
  );
};
