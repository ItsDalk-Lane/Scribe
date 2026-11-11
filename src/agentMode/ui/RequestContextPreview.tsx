import type { RequestContextPreview } from "@/agentMode/session/types";
import { ReactModal } from "@/components/modals/ReactModal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/lib/i18n";
import type { App } from "obsidian";
import React, { useEffect, useState } from "react";

export interface RequestContextPreviewViewProps {
  preview?: RequestContextPreview | null;
  loading?: boolean;
  error?: string;
  onClose: () => void;
}

export function RequestContextPreviewView({
  preview,
  loading = false,
  error,
  onClose,
}: RequestContextPreviewViewProps) {
  return (
    <div className="tw-flex tw-min-w-0 tw-flex-col tw-gap-3">
      <p className="tw-text-sm tw-text-muted">
        {t(
          "This is the saved input handed to the model adapter. Provider formatting may differ. Opening this view does not send a request."
        )}
      </p>
      {loading ? (
        <p role="status">{t("Loading saved request...")}</p>
      ) : error ? (
        <p role="alert" className="tw-text-error">
          {error}
        </p>
      ) : preview ? (
        <>
          <p className="tw-break-all tw-text-sm tw-text-muted">
            {preview.provider} · {preview.modelId} · {preview.requestId}
          </p>
          <Textarea
            aria-label={t("Saved request input")}
            readOnly
            value={preview.content}
            rows={16}
            className="tw-min-h-64 tw-w-full tw-font-mono tw-text-sm"
          />
        </>
      ) : (
        <p>
          {t(
            "No saved request is available for this chat. Older chats may not contain request records."
          )}
        </p>
      )}
      <div className="tw-flex tw-justify-end">
        <Button onClick={onClose}>{t("Close")}</Button>
      </div>
    </div>
  );
}

export interface RequestContextPreviewDialogProps {
  load: () => Promise<RequestContextPreview | null>;
  onClose: () => void;
}

export function RequestContextPreviewDialog({ load, onClose }: RequestContextPreviewDialogProps) {
  const [state, setState] = useState<Omit<RequestContextPreviewViewProps, "onClose">>({
    loading: true,
  });
  useEffect(() => {
    let active = true;
    void load().then(
      (preview) => {
        if (active) setState({ preview });
      },
      (error: unknown) => {
        if (active)
          setState({
            error: error instanceof Error ? t(error.message) : t("Could not read saved request."),
          });
      }
    );
    return () => {
      active = false;
    };
  }, [load]);
  return <RequestContextPreviewView {...state} onClose={onClose} />;
}

export class RequestContextPreviewModal extends ReactModal {
  constructor(
    app: App,
    private readonly load: () => Promise<RequestContextPreview | null>
  ) {
    super(app, t("View last request"));
  }

  protected renderContent(close: () => void): React.ReactElement {
    return <RequestContextPreviewDialog load={this.load} onClose={close} />;
  }
}
