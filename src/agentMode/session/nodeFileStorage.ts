import type { AgentSessionIndexStorage } from "./AgentSessionIndex";
import { requireNodeModule } from "@/utils/desktopRuntime";
import type { AgentSnapshotStorage } from "@/agentMode/session/AgentSessionSnapshots";
import { v4 as uuidv4 } from "uuid";

export function createNodeFileStorage(): AgentSessionIndexStorage {
  const { mkdir, readFile, stat, writeFile } =
    requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("path");
  return {
    exists: async (p) => {
      try {
        await stat(p);
        return true;
      } catch {
        return false;
      }
    },
    read: (p) => readFile(p, "utf8"),
    write: async (p, content) => {
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, content, "utf8");
    },
  };
}

export function createNodeSnapshotStorage(): AgentSnapshotStorage {
  const { mkdir, writeFile, rename, rm } =
    requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("path");
  return {
    ...createNodeFileStorage(),
    write: async (destination, content) => {
      await mkdir(path.dirname(destination), { recursive: true });
      const temporary = `${destination}.${uuidv4()}.tmp`;
      try {
        await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, destination);
      } finally {
        await rm(temporary, { force: true });
      }
    },
    remove: (destination) => rm(destination, { force: true }),
  };
}
