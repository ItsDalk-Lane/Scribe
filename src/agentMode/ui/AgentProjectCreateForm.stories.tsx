import { AgentProjectCreateForm } from "./AgentProjectCreateForm";
import type { Meta, StoryObj } from "@/lib/story";
import type { ComponentProps } from "react";

type CreateProjectProps = ComponentProps<typeof AgentProjectCreateForm>;

const meta = {
  title: "Agent Mode/Create Project",
  component: AgentProjectCreateForm,
  args: { title: "New project", onSave: async () => {}, onCancel: () => {} },
  parameters: { gallery: { host: "popover", layout: "padded" } },
} satisfies Meta<CreateProjectProps>;
export default meta;

export const NewFolder: StoryObj<CreateProjectProps> = {
  args: { onChooseWorkspace: (select) => select("Research") },
};

export const ChooseVaultRoot: StoryObj<CreateProjectProps> = {
  args: { onChooseWorkspace: (select) => select("") },
};

export const LongExistingFolder: StoryObj<CreateProjectProps> = {
  args: {
    onChooseWorkspace: (select) =>
      select("Research/Interviews/Customer experience and product exploration"),
  },
};
