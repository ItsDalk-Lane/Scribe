import React from "react";

export interface AssistantResponseFooterProps {
  leading?: React.ReactNode;
  timestamp?: React.ReactNode;
  afterTimestamp?: React.ReactNode;
  actions?: React.ReactNode;
}

export const AssistantResponseFooter: React.FC<AssistantResponseFooterProps> = ({
  leading,
  timestamp,
  afterTimestamp,
  actions,
}) => {
  const hasLeading = leading !== undefined && leading !== null && leading !== false;
  const hasTimestamp =
    !hasLeading && timestamp !== undefined && timestamp !== null && timestamp !== false;
  const hasActions = actions !== undefined && actions !== null && actions !== false;
  const hasMetadata = hasLeading || hasTimestamp || !!afterTimestamp;

  return (
    <div className="tw-flex tw-min-w-0 tw-items-center tw-justify-between tw-gap-2">
      {hasMetadata ? (
        <div className="tw-flex tw-min-w-0 tw-flex-wrap tw-items-center tw-gap-x-2 tw-gap-y-1">
          {hasLeading ? (
            <div data-response-footer-leading className="tw-shrink-0">
              {leading}
            </div>
          ) : null}
          {hasTimestamp ? (
            <div className="tw-truncate tw-text-xs tw-text-faint">{timestamp}</div>
          ) : null}
          {afterTimestamp}
        </div>
      ) : null}
      {hasActions ? (
        <div data-response-footer-actions className="tw-ml-auto tw-shrink-0">
          {actions}
        </div>
      ) : null}
    </div>
  );
};
