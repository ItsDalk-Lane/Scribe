import { useCallback, useState } from "react";

export interface TrailExpansion {
  isOpen: (id: string, defaultOpen?: boolean) => boolean;
  toggle: (id: string, defaultOpen?: boolean) => void;
}

const NO_OVERRIDES: ReadonlyMap<string, boolean> = new Map();

export function useTrailExpansion(isStreaming = false): TrailExpansion {
  const [state, setState] = useState(() => ({ isStreaming, overrides: NO_OVERRIDES }));
  if (state.isStreaming !== isStreaming) {
    setState({ isStreaming, overrides: NO_OVERRIDES });
  }

  const toggle = useCallback((id: string, defaultOpen?: boolean) => {
    setState((previous) => {
      const overrides = new Map(previous.overrides);
      overrides.set(id, !(overrides.get(id) ?? defaultOpen ?? previous.isStreaming));
      return { ...previous, overrides };
    });
  }, []);

  const isOpen = useCallback(
    (id: string, defaultOpen = isStreaming) => state.overrides.get(id) ?? defaultOpen,
    [state.overrides, isStreaming]
  );

  return { isOpen, toggle };
}
