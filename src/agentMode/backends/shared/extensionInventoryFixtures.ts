import type {
  ExtensionDiscoveryInput,
  ExtensionFs,
} from "@/agentMode/backends/shared/extensionInventory";

export function input(
  files: Record<string, string>,
  env: Record<string, string> = {}
): ExtensionDiscoveryInput {
  const fs: ExtensionFs = {
    read: async (path) => {
      if (path in files) return files[path];
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    list: async (path) =>
      [
        ...new Set(
          Object.keys(files)
            .filter((file) => file.startsWith(`${path}/`))
            .map((file) => file.slice(path.length + 1).split("/")[0])
        ),
      ].sort(),
    realpath: async (path) => path,
  };
  return { home: "/home", cwd: "/vault", env, fs };
}

export const skill = (name: string) =>
  `---\nname: ${name}\ndescription: Helpful instructions\n---\nBody`;
