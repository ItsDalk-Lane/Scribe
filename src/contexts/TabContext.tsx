import type { ScribeSettingsTabId } from "@/settings/settingsTabs";
import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";

interface TabContextType {
  selectedTab: ScribeSettingsTabId;
  setSelectedTab: (tab: ScribeSettingsTabId) => void;
  registerBeforeLeave: (guard: () => Promise<void>) => () => void;
}

const TabContext = createContext<TabContextType | undefined>(undefined);

interface TabProviderProps {
  children: React.ReactNode;
  initialTab?: ScribeSettingsTabId;
}

export const TabProvider: React.FC<TabProviderProps> = ({ children, initialTab = "basic" }) => {
  const [selectedTab, selectTab] = useState<ScribeSettingsTabId>(initialTab);
  const beforeLeave = useRef<(() => Promise<void>) | null>(null);
  const navigation = useRef(0);
  const registerBeforeLeave = useCallback((guard: () => Promise<void>) => {
    beforeLeave.current = guard;
    return () => {
      if (beforeLeave.current === guard) beforeLeave.current = null;
    };
  }, []);
  const setSelectedTab = useCallback(
    (tab: ScribeSettingsTabId) => {
      if (tab === selectedTab) return;
      const revision = ++navigation.current;
      const guard = beforeLeave.current;
      if (!guard) {
        selectTab(tab);
        return;
      }
      void guard().then(
        () => {
          if (revision === navigation.current) selectTab(tab);
        },
        () => undefined
      );
    },
    [selectedTab]
  );
  const value = useMemo(
    () => ({ selectedTab, setSelectedTab, registerBeforeLeave }),
    [selectedTab, setSelectedTab, registerBeforeLeave]
  );

  return <TabContext.Provider value={value}>{children}</TabContext.Provider>;
};

export const useTab = () => {
  const context = useContext(TabContext);
  if (context === undefined) {
    throw new Error("useTab must be used within a TabProvider");
  }
  return context;
};

export function useSettingsLeaveGuard(guard: () => Promise<void>): void {
  const register = useContext(TabContext)?.registerBeforeLeave;
  useEffect(() => register?.(guard), [guard, register]);
}
