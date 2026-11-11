import React from "react";
import { ContextManage } from "./context-manage-modal";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import type { Meta, StoryObj } from "@/lib/story";
import type { ProjectConfig } from "@/aiParams";

const project: ProjectConfig = {
  id: "gallery-project",
  name: "Research",
  systemPrompt: "",
  contextSource: { webUrls: "https://example.test/reference" },
  created: 1,
  UsageTimestamps: 1,
};

const meta = {
  title: "Project/Context Save",
  parameters: { gallery: { host: "modal", layout: "fullscreen" } },
} satisfies Meta;
export default meta;

function FailedSave() {
  const app = useApp();
  return (
    <ContextManage
      app={app}
      initialProject={project}
      onCancel={() => {}}
      onSave={async () => {
        throw new Error("Simulated save failure");
      }}
    />
  );
}

export const FailureKeepsEditor: StoryObj = { render: () => <FailedSave /> };

function PendingSave() {
  const app = useApp();
  const complete = React.useRef<(() => void) | null>(null);
  const [pending, setPending] = React.useState(false);
  return (
    <>
      {pending && (
        <Button
          onClick={() => {
            complete.current?.();
            setPending(false);
          }}
        >
          Complete simulated save
        </Button>
      )}
      <ContextManage
        app={app}
        initialProject={project}
        onCancel={() => {}}
        onSave={() => {
          setPending(true);
          return new Promise<void>((resolve) => {
            complete.current = resolve;
          });
        }}
      />
    </>
  );
}

export const PendingKeepsEditor: StoryObj = { render: () => <PendingSave /> };
