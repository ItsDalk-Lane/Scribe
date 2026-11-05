import { ModelSelector, type ModelSelectorEntry } from "@/components/ui/ModelSelector";
import type { Meta, StoryObj } from "@/lib/story";
import type { ComponentProps } from "react";

type ModelSelectorProps = ComponentProps<typeof ModelSelector>;

const OWN_MODELS: ModelSelectorEntry[] = [
  {
    name: "grok-code",
    provider: "opencode",
    displayName: "opencode/grok-code",
    enabled: true,
    _group: "OpenCode",
    _isFree: true,
  },
  {
    name: "claude-sonnet-4-6",
    provider: "anthropic",
    displayName: "anthropic/claude-sonnet-4-6",
    enabled: true,
    _group: "OpenCode",
  },
];

const meta = {
  title: "UI/Model Selector",
  component: ModelSelector,
  args: {
    value: "grok-code|opencode",
    onChange: () => undefined,
    models: OWN_MODELS,
  },
  parameters: { gallery: { host: "popover", layout: "padded" } },
} satisfies Meta<ModelSelectorProps>;
export default meta;

export const ConfiguredModels: StoryObj<ModelSelectorProps> = {};

export const NoModelsConfigured: StoryObj<ModelSelectorProps> = {
  args: { value: "", models: [] },
};

export const MissingApiKey: StoryObj<ModelSelectorProps> = {
  args: {
    value: "",
    models: [
      {
        name: "claude-sonnet-4-6",
        provider: "anthropic",
        displayName: "Claude Sonnet",
        enabled: true,
        _group: "My providers",
        _disabledReason: "Add your API key in BYOK settings.",
      },
    ],
  },
};

export const CommandNeedsSelection: StoryObj<ModelSelectorProps> = { args: { value: "" } };

export const UnreadableApiKey: StoryObj<ModelSelectorProps> = {
  args: {
    value: "",
    models: [
      {
        name: "configured-cloud-model",
        provider: "agent",
        displayName: "Configured chat model",
        enabled: true,
        _group: "Scribe",
        _disabledReason: "Cannot read API key on this device",
      },
    ],
  },
};
