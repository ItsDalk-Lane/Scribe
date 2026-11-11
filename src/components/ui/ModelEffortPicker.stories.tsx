import { ModelEffortPicker } from "@/components/ui/ModelEffortPicker";
import type { Meta, StoryObj } from "@/lib/story";
import type { ComponentProps } from "react";

type Props = ComponentProps<typeof ModelEffortPicker>;
const meta = {
  title: "UI/Model Effort Picker",
  component: ModelEffortPicker,
  parameters: { gallery: { host: "popover", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;

export const ConcreteEffort = {
  args: {
    override: {
      models: [{ name: "example", displayName: "Example model", provider: "agent", enabled: true }],
      value: "example|agent",
      effort: {
        value: "low",
        options: [
          { value: "low", label: "Low" },
          { value: "high", label: "High" },
        ],
        onChange: () => undefined,
      },
      effortOptionsByModelKey: {
        "example|agent": [
          { value: "low", label: "Low" },
          { value: "high", label: "High" },
        ],
      },
      commitSelection: () => undefined,
    },
  },
} satisfies StoryObj<Props>;
export const HighEffort: StoryObj<Props> = {
  args: {
    override: {
      ...ConcreteEffort.args.override,
      effort: { ...ConcreteEffort.args.override.effort, value: "high" },
    },
  },
};
export const NoEffortControl: StoryObj<Props> = {
  args: {
    override: {
      ...ConcreteEffort.args.override,
      effort: undefined,
      effortOptionsByModelKey: { "example|agent": [] },
    },
  },
};

const NATIVE_EFFORT_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "high", label: "High" },
];

export const NativeProviderDefault: StoryObj<Props> = {
  args: {
    override: {
      ...ConcreteEffort.args.override,
      effort: {
        ...ConcreteEffort.args.override.effort,
        value: "default",
        options: NATIVE_EFFORT_OPTIONS,
      },
      effortOptionsByModelKey: { "example|agent": NATIVE_EFFORT_OPTIONS },
    },
  },
};

export const NativeThinkingOff: StoryObj<Props> = {
  args: {
    override: {
      ...NativeProviderDefault.args!.override!,
      effort: {
        ...ConcreteEffort.args.override.effort,
        value: "off",
        options: NATIVE_EFFORT_OPTIONS,
      },
    },
  },
};

export const AlwaysThinking: StoryObj<Props> = {
  args: {
    override: {
      ...ConcreteEffort.args.override,
      models: [
        { name: "glm-5.3-flash", displayName: "GLM-5.3-Flash", provider: "agent", enabled: true },
      ],
      value: "glm-5.3-flash|agent",
      effort: {
        value: "high",
        options: [
          { value: "default", label: "Default" },
          { value: "low", label: "low" },
          { value: "high", label: "high" },
          { value: "max", label: "max" },
        ],
        onChange: () => undefined,
      },
      effortOptionsByModelKey: {
        "glm-5.3-flash|agent": [
          { value: "default", label: "Default" },
          { value: "low", label: "low" },
          { value: "high", label: "high" },
          { value: "max", label: "max" },
        ],
      },
    },
  },
};

export const CustomEndpointLabels: StoryObj<Props> = {
  args: {
    override: {
      ...ConcreteEffort.args.override,
      models: [
        {
          name: "d5df8680-65f4-4c4b-81d2-7797550f47fe/auto",
          displayName: "Office LiteLLM proxy/auto",
          provider: "agent",
          enabled: true,
          _group: "opencode",
        },
        {
          name: "8a1c33e2-0f5b-4a7e-9d61-2b7f4c0e9a10/auto",
          displayName: "Home lab vLLM server running on the basement workstation/auto",
          provider: "agent",
          enabled: true,
          _group: "opencode",
        },
        {
          name: "ollama/llama3.2",
          displayName: "ollama/llama3.2",
          provider: "agent",
          enabled: true,
          _group: "opencode",
        },
      ],
      value: "d5df8680-65f4-4c4b-81d2-7797550f47fe/auto|agent",
      effort: undefined,
      effortOptionsByModelKey: {},
    },
  },
};
