import { t } from "@/lib/i18n";
import type { Skill } from "@/agentMode";
import { ChatSendButton } from "@/components/ui/ChatSendButton";
import { Button } from "@/components/ui/button";
import { ModelSelector, type ModelSelectorEntry } from "@/components/ui/ModelSelector";
import type { ScribeMode } from "@/agentMode";
import {
  mergeWebTabContexts,
  normalizeUrlString,
  normalizeWebTabContext,
} from "@/utils/urlNormalization";

import { SelectedTextContext, WebTabContext } from "@/types/message";
import { isAllowedFileForNoteContext } from "@/utils";
import { getFileIdentityKey } from "@/utils/fileListUtils";
import { Square, X } from "lucide-react";
import { App, TFile, TFolder } from "obsidian";
import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { $getRoot, $createTextNode, LexicalEditor as LexicalEditorType } from "lexical";
import { ContextControl } from "./ContextControl";
import { AddContextButton } from "./AddContextButton";
import { openImagePicker } from "./openImagePicker";
import { ModelEffortPicker } from "@/components/ui/ModelEffortPicker";
import { ModePicker } from "@/components/ui/ModePicker";
import { $removePillsByPath } from "./pills/NotePillNode";
import { $removeActiveNotePills } from "./pills/ActiveNotePillNode";
import { $removePillsByFolder } from "./pills/FolderPillNode";
import { $removeActiveWebTabPills } from "./pills/ActiveWebTabPillNode";
import { $findWebTabPills, $removeWebTabPillsByUrl } from "./pills/WebTabPillNode";
import LexicalEditor from "./LexicalEditor";
import { cn } from "@/lib/utils";
import { useObjectUrl } from "@/hooks/useObjectUrl";

const ACCENT_CIRCLE_BUTTON_CLASS =
  "tw-rounded-full tw-bg-interactive-accent tw-text-on-accent hover:tw-bg-interactive-accent-hover";

const NO_MODELS: ModelSelectorEntry[] = [];

const NOOP = () => {};

const DEFAULT_PLACEHOLDER =
  "Your AI assistant for Obsidian • @ to add context • / for custom prompts";

export interface ChatInputProps {
  slashSkills?: readonly Skill[];
  placeholder?: string;
  inputMessage: string;
  setInputMessage: (message: string) => void;
  handleSendMessage: (metadata?: {
    contextNotes?: TFile[];
    contextFolders?: string[];
    webTabs?: WebTabContext[];
  }) => void;
  isGenerating: boolean;
  onStopGenerating: () => void;
  app: App;
  contextNotes: TFile[];
  setContextNotes: React.Dispatch<React.SetStateAction<TFile[]>>;
  contextWebTabs?: WebTabContext[];
  setContextWebTabs?: React.Dispatch<React.SetStateAction<WebTabContext[]>>;
  includeActiveNote: boolean;
  setIncludeActiveNote: (include: boolean) => void;
  includeActiveWebTab: boolean;
  setIncludeActiveWebTab: (include: boolean) => void;
  activeWebTab: WebTabContext | null;
  selectedImages: File[];
  onAddImage: (files: File[]) => void;
  setSelectedImages: React.Dispatch<React.SetStateAction<File[]>>;
  disableModelSwitch?: boolean;
  modelPickerOverride?: {
    models: ModelSelectorEntry[];
    value: string;
    onChange: (modelKey: string) => void;
    disabled?: boolean;
    effort?: {
      options: { label: string; value: string | null }[];
      value: string | null;
      onChange: (value: string | null) => void;
      disabled?: boolean;
    };
    effortOptionsByModelKey?: Record<string, { label: string; value: string | null }[]>;
    commitSelection?: (modelKey: string, effort: string | null) => void;
  };
  modePickerOverride?: {
    options: { label: string; value: ScribeMode }[];
    value: ScribeMode | null;
    onChange: (value: ScribeMode) => void;
    disabled?: boolean;
  };
  selectedTextContexts?: SelectedTextContext[];
  onRemoveSelectedText?: (id: string) => void;

  onEscape?: () => void;
  onShiftTab?: () => void;
}

interface SelectedImagePreviewProps {
  file: File;
}

function SelectedImagePreview({ file }: SelectedImagePreviewProps) {
  const url = useObjectUrl(file);
  return <img src={url} alt={file.name} className="selected-image-preview" />;
}

export interface ChatInputHandle {
  prependContent(text: string, webTabs: readonly WebTabContext[]): void;
}

const ChatInput = React.forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(
  {
    placeholder,
    inputMessage,
    setInputMessage,
    handleSendMessage,
    isGenerating,
    onStopGenerating,
    app,
    contextNotes,
    setContextNotes,
    contextWebTabs: controlledWebTabs,
    setContextWebTabs: setControlledWebTabs,
    includeActiveNote,
    setIncludeActiveNote,
    includeActiveWebTab,
    setIncludeActiveWebTab,
    activeWebTab,
    selectedImages,
    onAddImage,
    setSelectedImages,
    disableModelSwitch,
    modelPickerOverride,
    modePickerOverride,
    selectedTextContexts,
    onRemoveSelectedText,
    onEscape,
    onShiftTab,
    slashSkills,
  },
  ref
) {
  const [contextFolders, setContextFolders] = useState<string[]>([]);
  const [localWebTabs, setLocalWebTabs] = useState<WebTabContext[]>([]);
  const contextWebTabs = controlledWebTabs ?? localWebTabs;
  const setContextWebTabs = setControlledWebTabs ?? setLocalWebTabs;
  const containerRef = useRef<HTMLDivElement>(null);
  const lexicalEditorRef = useRef<LexicalEditorType | null>(null);
  const [currentActiveNote, setCurrentActiveNote] = useState<TFile | null>(() => {
    const activeFile = app.workspace.getActiveFile();
    return isAllowedFileForNoteContext(activeFile) ? activeFile : null;
  });
  const [notesFromPills, setNotesFromPills] = useState<{ path: string; basename: string }[]>([]);
  const [foldersFromPills, setFoldersFromPills] = useState<string[]>([]);
  const [webTabsFromPills, setWebTabsFromPills] = useState<WebTabContext[]>([]);

  const mergedContextWebTabs = useMemo(() => {
    return mergeWebTabContexts([...contextWebTabs, ...webTabsFromPills]);
  }, [contextWebTabs, webTabsFromPills]);

  const getWebTabsFromEditorSnapshot = (): WebTabContext[] => {
    const editor = lexicalEditorRef.current;
    if (!editor) {
      return webTabsFromPills;
    }

    return editor.read((): WebTabContext[] => {
      const pills = $findWebTabPills();
      return pills.map((pill) => ({
        url: pill.getURL(),
        title: pill.getTitle(),
        faviconUrl: pill.getFaviconUrl(),
      }));
    });
  };

  const showsStop = isGenerating && inputMessage.trim().length === 0 && selectedImages.length === 0;

  const onSendMessage = () => {
    const webTabsFromEditor = getWebTabsFromEditorSnapshot();
    const allWebTabs = mergeWebTabContexts([...contextWebTabs, ...webTabsFromEditor]);

    handleSendMessage({ webTabs: allWebTabs });
  };

  const handleNotePillsRemoved = (removedNotes: { path: string; basename: string }[]) => {
    const removedPaths = new Set(removedNotes.map((note) => note.path));

    setContextNotes((prev) => {
      return prev.filter((contextNote) => {
        return !removedPaths.has(contextNote.path);
      });
    });
  };

  const handleContextNoteRemoved = (notePath: string) => {
    if (lexicalEditorRef.current) {
      lexicalEditorRef.current.update(() => {
        $removePillsByPath(notePath);
      });
    }

    setNotesFromPills((prev) => prev.filter((note) => note.path !== notePath));
  };

  const handleFolderContextRemoved = (folderPath: string) => {
    if (lexicalEditorRef.current) {
      lexicalEditorRef.current.update(() => {
        $removePillsByFolder(folderPath);
      });
    }

    setFoldersFromPills((prev) => prev.filter((pillFolder) => pillFolder !== folderPath));
  };

  const handleAddToContext = (
    category: string,
    data: TFile | string | TFolder | WebTabContext | null
  ) => {
    switch (category) {
      case "activeNote":
        setIncludeActiveNote(true);
        break;
      case "notes":
        if (data instanceof TFile) {
          const activeNote = app.workspace.getActiveFile();
          if (activeNote && data.path === activeNote.path) {
            setIncludeActiveNote(true);
            setContextNotes((prev) => prev.filter((n) => n.path !== data.path));
          } else {
            setContextNotes((prev) => {
              const existingNote = prev.find((n) => n.path === data.path);
              if (existingNote) {
                return prev;
              } else {
                return [...prev, data];
              }
            });
          }
        }
        break;
      case "folders":
        if (data && typeof (data as { path?: unknown }).path === "string") {
          const folderPath = (data as { path: string }).path;
          setContextFolders((prev) => {
            const exists = prev.find((f) => f === folderPath);
            if (!exists) {
              return [...prev, folderPath];
            }
            return prev;
          });
        }
        break;
      case "webTabs":
        if (
          data &&
          typeof data === "object" &&
          "url" in data &&
          typeof (data as { url: unknown }).url === "string"
        ) {
          const normalized = normalizeWebTabContext(data);
          if (!normalized) break;

          const activeUrl = normalizeUrlString(activeWebTab?.url);
          if (activeUrl && normalized.url === activeUrl) {
            setIncludeActiveWebTab(true);
            setContextWebTabs((prev) =>
              prev.filter((t) => normalizeUrlString(t.url) !== activeUrl)
            );
            break;
          }

          setContextWebTabs((prev) => mergeWebTabContexts([...prev, normalized]));
        }
        break;
      case "activeWebTab":
        setIncludeActiveWebTab(true);
        {
          const activeUrl = normalizeUrlString(activeWebTab?.url);
          if (activeUrl) {
            setContextWebTabs((prev) =>
              prev.filter((t) => normalizeUrlString(t.url) !== activeUrl)
            );
          }
        }
        break;
      case "images": {
        const doc = containerRef.current?.doc;
        if (!doc) break;
        openImagePicker(doc, {
          onFiles: onAddImage,
          onSettle: () => lexicalEditorRef.current?.focus(),
        });
        break;
      }
    }
  };

  const handleRemoveFromContext = (category: string, data: string) => {
    switch (category) {
      case "activeNote":
        setIncludeActiveNote(false);
        if (lexicalEditorRef.current) {
          lexicalEditorRef.current.update(() => {
            $removeActiveNotePills();
          });
        }
        break;
      case "notes":
        if (typeof data === "string") {
          if (currentActiveNote?.path === data && includeActiveNote) {
            setIncludeActiveNote(false);
          } else {
            setContextNotes((prev) => prev.filter((note) => note.path !== data));
          }
          handleContextNoteRemoved(data);
        }
        break;
      case "folders":
        if (typeof data === "string") {
          setContextFolders((prev) => prev.filter((f) => f !== data));
          handleFolderContextRemoved(data);
        }
        break;
      case "selectedText":
        if (typeof data === "string") {
          onRemoveSelectedText?.(data);
        }
        break;
      case "activeWebTab":
        setIncludeActiveWebTab(false);
        if (lexicalEditorRef.current) {
          lexicalEditorRef.current.update(() => {
            $removeActiveWebTabPills();
          });
        }
        break;
      case "webTabs":
        if (typeof data === "string") {
          const url = normalizeUrlString(data);
          if (!url) break;

          setContextWebTabs((prev) => prev.filter((t) => normalizeUrlString(t.url) !== url));
          setWebTabsFromPills((prev) => prev.filter((t) => normalizeUrlString(t.url) !== url));
          if (lexicalEditorRef.current) {
            lexicalEditorRef.current.update(() => {
              $removeWebTabPillsByUrl(url);
            });
          }
        }
        break;
    }
  };

  const handleFolderPillsRemoved = (removedFolders: string[]) => {
    const removedFolderPaths = new Set(removedFolders);

    setContextFolders((prev) => {
      return prev.filter((folder) => {
        if (removedFolderPaths.has(folder)) {
          return false;
        }
        return true;
      });
    });
  };

  useEffect(() => {
    setContextNotes((prev) => {
      const contextPaths = new Set(prev.map((note) => note.path));

      const newNotesFromPills = notesFromPills.filter((pillNote) => {
        return !contextPaths.has(pillNote.path);
      });

      const newFiles: TFile[] = [];
      newNotesFromPills.forEach((pillNote) => {
        const file = app.vault.getAbstractFileByPath(pillNote.path);
        if (file instanceof TFile) {
          newFiles.push(file);
        }
      });

      return [...prev, ...newFiles];
    });
  }, [notesFromPills, app.vault, setContextNotes]);

  useEffect(() => {
    // eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- merge pill folders into user-owned context without removing manual entries
    setContextFolders((prev) => {
      const contextFolderPaths = new Set(prev);
      const newFoldersFromPills = foldersFromPills.filter(
        (pillFolder) => !contextFolderPaths.has(pillFolder)
      );
      return [...prev, ...newFoldersFromPills];
    });
  }, [foldersFromPills]);

  useEffect(() => {
    let timeoutId: number;

    const handleActiveLeafChange = () => {
      window.clearTimeout(timeoutId);

      timeoutId = window.setTimeout(() => {
        const activeNote = app.workspace.getActiveFile();
        setCurrentActiveNote(isAllowedFileForNoteContext(activeNote) ? activeNote : null);
      }, 100);
    };

    const eventRef = app.workspace.on("active-leaf-change", handleActiveLeafChange);

    return () => {
      window.clearTimeout(timeoutId);
      app.workspace.offref(eventRef);
    };
  }, [app.workspace]);

  const onEditorReady = useCallback((editor: LexicalEditorType) => {
    lexicalEditorRef.current = editor;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      prependContent(text, webTabs) {
        setContextWebTabs((previous) => mergeWebTabContexts([...webTabs, ...previous]));
        lexicalEditorRef.current?.update(
          () => {
            const root = $getRoot();
            const separator = root.getTextContent().trim() ? "\n\n" : "";
            root.selectStart().insertNodes([$createTextNode(text + separator)]);
            setInputMessage(root.getTextContent());
          },
          { discrete: true }
        );
      },
    }),
    [setInputMessage, setContextWebTabs]
  );

  const handleActiveNoteAdded = useCallback(() => {
    setIncludeActiveNote(true);
  }, [setIncludeActiveNote]);

  const handleActiveNoteRemoved = useCallback(() => {
    setIncludeActiveNote(false);
  }, [setIncludeActiveNote]);

  const handleActiveWebTabAdded = useCallback(() => {
    setIncludeActiveWebTab(true);
  }, [setIncludeActiveWebTab]);

  const handleActiveWebTabRemoved = useCallback(() => {
    setIncludeActiveWebTab(false);
  }, [setIncludeActiveWebTab]);

  return (
    <div
      className={cn(
        "tw-flex tw-w-full tw-flex-col tw-gap-0.5 tw-rounded-md tw-border tw-border-solid tw-border-border tw-px-1 tw-pb-1 tw-pt-2 tw-@container/chat-input",
        modePickerOverride?.value === "plan" &&
          "tw-shadow-[0_0_10px_rgba(var(--color-blue-rgb),0.18)] tw-border-blue/60",
        modePickerOverride?.value === "auto" &&
          "tw-shadow-[0_0_10px_rgba(var(--color-red-rgb),0.18)] tw-border-red/60"
      )}
      ref={containerRef}
    >
      <div className="tw-flex tw-gap-1">
        <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-gap-0.5">
          <ContextControl
            contextNotes={contextNotes}
            includeActiveNote={includeActiveNote}
            activeNote={currentActiveNote}
            includeActiveWebTab={includeActiveWebTab}
            activeWebTab={activeWebTab}
            contextFolders={contextFolders}
            contextWebTabs={mergedContextWebTabs}
            selectedTextContexts={selectedTextContexts}
            onRemoveFromContext={handleRemoveFromContext}
          />

          {selectedImages.length > 0 && (
            <div className="selected-images">
              {selectedImages.map((file, index) => (
                <div key={getFileIdentityKey(file)} className="image-preview-container">
                  <SelectedImagePreview file={file} />
                  <button
                    type="button"
                    className="remove-image-button"
                    onClick={() => setSelectedImages((prev) => prev.filter((_, i) => i !== index))}
                    title={t("Remove image")}
                  >
                    <X className="tw-size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="tw-relative">
            <LexicalEditor
              slashSkills={slashSkills}
              value={inputMessage}
              onChange={(value) => setInputMessage(value)}
              onSubmit={onSendMessage}
              onNotesChange={setNotesFromPills}
              onNotesRemoved={handleNotePillsRemoved}
              onActiveNoteAdded={handleActiveNoteAdded}
              onActiveNoteRemoved={handleActiveNoteRemoved}
              onFoldersChange={setFoldersFromPills}
              onFoldersRemoved={handleFolderPillsRemoved}
              onWebTabsChange={setWebTabsFromPills}
              onActiveWebTabAdded={handleActiveWebTabAdded}
              onActiveWebTabRemoved={handleActiveWebTabRemoved}
              onEditorReady={onEditorReady}
              onImagePaste={onAddImage}
              placeholder={placeholder ?? t(DEFAULT_PLACEHOLDER)}
              currentActiveFile={currentActiveNote}
              onEscape={onEscape}
              onShiftTab={onShiftTab}
            />
          </div>
        </div>
      </div>

      <div className="tw-flex tw-h-7 tw-justify-between tw-gap-1 tw-px-1">
        <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-1">
          <AddContextButton
            onSelect={handleAddToContext}
            currentActiveFile={currentActiveNote}
            lexicalEditorRef={lexicalEditorRef}
          />
          {modelPickerOverride?.effortOptionsByModelKey && modelPickerOverride.commitSelection ? (
            <ModelEffortPicker
              override={{
                models: modelPickerOverride.models,
                value: modelPickerOverride.value,
                disabled: modelPickerOverride.disabled,
                effort: modelPickerOverride.effort,
                effortOptionsByModelKey: modelPickerOverride.effortOptionsByModelKey,
                commitSelection: modelPickerOverride.commitSelection,
              }}
              className="tw-min-w-0 tw-max-w-full tw-truncate"
            />
          ) : (
            <ModelSelector
              variant="ghost2"
              size="fit"
              disabled={
                modelPickerOverride?.disabled ?? (disableModelSwitch || !modelPickerOverride)
              }
              value={modelPickerOverride?.value ?? ""}
              models={modelPickerOverride?.models ?? NO_MODELS}
              onChange={modelPickerOverride?.onChange ?? NOOP}
              className="tw-min-w-0 tw-max-w-full tw-truncate"
            />
          )}
        </div>

        <div className="tw-flex tw-items-center tw-gap-1">
          {modePickerOverride && <ModePicker override={modePickerOverride} />}
          {showsStop ? (
            <Button
              size="icon"
              className={cn(ACCENT_CIRCLE_BUTTON_CLASS)}
              aria-label={t("Stop generating")}
              onClick={() => onStopGenerating()}
            >
              <Square className="tw-size-3 tw-fill-current" />
            </Button>
          ) : (
            <ChatSendButton
              inputMessage={inputMessage}
              imageCount={selectedImages.length}
              onSend={() => onSendMessage()}
            />
          )}
        </div>
      </div>
    </div>
  );
});

export default ChatInput;
