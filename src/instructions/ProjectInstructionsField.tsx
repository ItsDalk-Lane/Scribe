import { FormField } from "@/components/ui/form-field";
import { InstructionsTextarea } from "@/instructions/InstructionsTextarea";
import { t } from "@/lib/i18n";
import React from "react";

const LABEL = "Project instructions";

export interface ProjectInstructionsFieldProps {
  value: string;
  onChange: (next: string) => void;
}

export const ProjectInstructionsField: React.FC<ProjectInstructionsFieldProps> = ({
  value,
  onChange,
}) => (
  <FormField
    label={t(LABEL)}
    description={t(
      "Project and vault instructions are provided to the agent in this project. If they conflict, no priority is guaranteed. Saved to AGENTS.md in the project folder, which you can also edit as a note."
    )}
  >
    <InstructionsTextarea label={t(LABEL)} value={value} onChange={onChange} />
  </FormField>
);
