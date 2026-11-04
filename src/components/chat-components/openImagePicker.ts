interface ImagePickerHandlers {
  onFiles: (files: File[]) => void;
  onSettle?: () => void;
}

export function openImagePicker(doc: Document, handlers: ImagePickerHandlers): void {
  const input = doc.body.createEl("input", {
    cls: "tw-hidden",
    attr: { type: "file", accept: "image/*", multiple: true },
  });

  const settle = (): void => {
    input.remove();
    handlers.onSettle?.();
  };

  input.addEventListener(
    "change",
    () => {
      handlers.onFiles(Array.from(input.files ?? []));
      settle();
    },
    { once: true }
  );
  input.addEventListener("cancel", settle, { once: true });

  input.click();
}
