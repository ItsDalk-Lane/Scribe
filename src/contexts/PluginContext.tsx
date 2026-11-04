import type ScribePlugin from "@/main";
import React, { createContext, useContext } from "react";

const PluginContext = createContext<ScribePlugin | undefined>(undefined);

export const PluginProvider: React.FC<{
  plugin: ScribePlugin;
  children: React.ReactNode;
}> = ({ plugin, children }) => (
  <PluginContext.Provider value={plugin}>{children}</PluginContext.Provider>
);

export const usePlugin = (): ScribePlugin => {
  const plugin = useContext(PluginContext);
  if (!plugin) throw new Error("usePlugin must be used inside <PluginProvider>");
  return plugin;
};
