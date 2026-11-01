import type { App, Modal, Scope } from "obsidian";

const historyStacks = new WeakMap<Window, Modal[]>();
const owners = new WeakMap<Modal, Window>();

export function nativeModalHistoryBack(win: Window): void {
  historyStacks.get(win)?.at(-1)?.close();
}

export function nativeModalFixture(Base: typeof Modal): typeof Modal {
  return class NativeModalFixture extends Base {
    private opened = false;
    private readonly handleKeyDown = (event: KeyboardEvent): void => {
      const containers = this.containerEl.doc.querySelectorAll(".modal-container");
      if (event.key !== "Escape" || containers.item(containers.length - 1) !== this.containerEl)
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.close();
    };

    constructor(app: App) {
      super(app);
      for (const method of ["open", "close", "onOpen", "onClose"])
        delete (this as unknown as Record<string, unknown>)[method];
      this.scope = {} as Scope;
      this.contentEl.empty = () => this.contentEl.replaceChildren();
      this.modalEl.setAttribute("role", "dialog");
    }

    open(): void {
      if (this.opened) return;
      this.opened = true;
      const win = activeWindow;
      owners.set(this, win);
      win.document.body.appendChild(this.containerEl);
      this.app.keymap.pushScope(this.scope);
      this.containerEl.doc.addEventListener("keydown", this.handleKeyDown);
      this.onOpen();
      const stack = historyStacks.get(win) ?? [];
      stack.push(this);
      historyStacks.set(win, stack);
    }

    close(): void {
      if (!this.opened) return;
      this.opened = false;
      this.app.keymap.popScope(this.scope);
      this.containerEl.doc.removeEventListener("keydown", this.handleKeyDown);
      this.containerEl.remove();
      this.onClose();
      const win = owners.get(this);
      if (win) {
        const stack = historyStacks.get(win);
        const index = stack?.indexOf(this) ?? -1;
        if (index >= 0) stack?.splice(index, 1);
      }
      owners.delete(this);
    }
  };
}
