import { useApp } from "@/context";
import { FolderSearchModal } from "@/components/modals/FolderSearchModal";
import { t } from "@/lib/i18n";
import { AgentProjectCreateForm } from "@/agentMode/ui/AgentProjectCreateForm";
import { computeVerticalPlacement } from "@/utils/panelPlacement";
import * as React from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface CreateProjectPanelProps {
  anchorEl: HTMLElement;
  onClose: () => void;
  onSave: (data: { name: string; workspacePath?: string }) => Promise<void>;
}

const MARGIN = 12;
const GAP = 6;
const PANEL_WIDTH = 260;
const ESTIMATED_HEIGHT = 140;

interface PanelPosition {
  top: number;
  left: number;
}

export function CreateProjectPanel({
  anchorEl,
  onClose,
  onSave,
}: CreateProjectPanelProps): React.ReactPortal {
  const app = useApp();
  const [choosingWorkspace, setChoosingWorkspace] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const doc = anchorEl.ownerDocument;
  const win = doc.defaultView ?? window;

  const computePosition = useCallback(
    (panelHeight: number): PanelPosition => {
      const rect = anchorEl.getBoundingClientRect();
      const { top } = computeVerticalPlacement({
        scrollRect: { top: 0, bottom: win.innerHeight },
        visibleBottom: rect,
        visibleTop: rect,
        panelHeight,
        margin: MARGIN,
        gap: GAP,
        viewportHeight: win.innerHeight,
      });
      const centeredLeft = rect.left + rect.width / 2 - PANEL_WIDTH / 2;
      const left = Math.max(MARGIN, Math.min(centeredLeft, win.innerWidth - PANEL_WIDTH - MARGIN));
      return { top, left };
    },
    [anchorEl, win]
  );

  const [position, setPosition] = useState<PanelPosition>(() => computePosition(ESTIMATED_HEIGHT));

  useLayoutEffect(() => {
    const reposition = () =>
      setPosition(computePosition(panelRef.current?.offsetHeight ?? ESTIMATED_HEIGHT));
    reposition();
    win.addEventListener("resize", reposition);
    return () => win.removeEventListener("resize", reposition);
  }, [computePosition, win]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!choosingWorkspace && e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        !choosingWorkspace &&
        target &&
        !panelRef.current?.contains(target) &&
        !anchorEl.contains(target)
      ) {
        onClose();
      }
    };
    win.addEventListener("keydown", onKeyDown);
    doc.addEventListener("mousedown", onPointerDown, true);
    return () => {
      win.removeEventListener("keydown", onKeyDown);
      doc.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [anchorEl, doc, win, onClose, choosingWorkspace]);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t("New project")}
      className="tw-fixed tw-z-popover tw-w-[260px] tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-3 tw-shadow-lg"
      style={{ top: position.top, left: position.left }}
    >
      <AgentProjectCreateForm
        title={t("New project")}
        subtitle={t("Create a new project in your vault")}
        onChooseWorkspace={(select) => {
          setChoosingWorkspace(true);
          const picker = new FolderSearchModal(app, select, {
            includeRoot: true,
            forWorkspace: true,
          });
          const close = picker.onClose.bind(picker);
          picker.onClose = () => {
            close();
            setChoosingWorkspace(false);
          };
          picker.open();
        }}
        onSave={onSave}
        onCancel={onClose}
      />
    </div>,
    doc.body
  );
}
