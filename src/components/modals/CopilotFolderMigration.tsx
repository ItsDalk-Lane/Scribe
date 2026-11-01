import { t } from "@/lib/i18n";
import type { HiddenFolderMigration } from "@/settings/revealCopilotFolder";
import React from "react";

export interface CopilotFolderMigrationProps {
  migration: HiddenFolderMigration;
}

export function CopilotFolderMigration({ migration }: CopilotFolderMigrationProps) {
  const { from, to } = migration;
  return (
    <div className="tw-flex tw-flex-col tw-gap-3 tw-whitespace-normal">
      <p className="tw-m-0">
        {t(
          'Scribe no longer supports hidden folders. Your Scribe folder "{from}" must move to a visible folder before Scribe can use it again.',
          { from }
        )}
      </p>
      {migration.status === "failed" ? (
        <p className="tw-m-0">
          {t(
            'Scribe could not move it: {reason}. Move the contents of "{from}" to "{to}" yourself.',
            { reason: migration.reason, from, to }
          )}
        </p>
      ) : migration.leftBehind.length === 0 ? (
        <p className="tw-m-0">{t('Your Scribe folder is now "{to}".', { to })}</p>
      ) : (
        <>
          <p className="tw-m-0">
            {t(
              'Your Scribe folder is now "{to}". These files stayed in "{from}" because "{to}" already has files with the same names. Move or merge them yourself:',
              { from, to }
            )}
          </p>
          <ul className="tw-m-0 tw-max-h-48 tw-overflow-y-auto tw-pl-5 tw-text-muted">
            {migration.leftBehind.map((path) => (
              <li key={path} className="tw-break-words">
                {path}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
