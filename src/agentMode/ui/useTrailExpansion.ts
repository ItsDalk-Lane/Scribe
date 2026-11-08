import { useCallback, useState } from "react";

export interface TrailExpansion {
  isOpen: (id: string, defaultOpen?: boolean) => boolean;
  toggle: (id: string, defaultOpen?: boolean) => void;
}

const NO_OVERRIDES: ReadonlyMap<string, boolean> = new Map();

export function useTrailExpansion(): TrailExpansion {
  const [overrides, setOverrides] = useState(NO_OVERRIDES);

  const toggle = useCallback((id: string, defaultOpen = false) => {
    setOverrides((previous) => {
      const next = new Map(previous);
      next.set(id, !(next.get(id) ?? defaultOpen));
      return next;
    });
  }, []);

  const isOpen = useCallback(
    (id: string, defaultOpen = false) => overrides.get(id) ?? defaultOpen,
    [overrides]
  );

  return { isOpen, toggle };
}
