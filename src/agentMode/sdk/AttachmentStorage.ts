import { createDurableFile } from "@/agentMode/sdk/JournalStorage";
import { requireNodeModule } from "@/utils/desktopRuntime";

function fingerprint(bytes: Uint8Array): string {
  const { createHash } = requireNodeModule<typeof import("node:crypto")>("crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

export class NodeAttachmentStorage {
  readonly directory: string;

  constructor(directory: string) {
    const path = requireNodeModule<typeof import("node:path")>("path");
    if (!path.isAbsolute(directory)) throw new Error("The attachment directory must be absolute.");
    this.directory = path.resolve(directory);
  }

  async put(bytes: Uint8Array): Promise<string> {
    const captured = new Uint8Array(bytes);
    const hash = fingerprint(captured);
    const path = requireNodeModule<typeof import("node:path")>("path");
    try {
      await this.get(hash);
      return hash;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!(await createDurableFile(path.join(this.directory, hash), captured))) await this.get(hash);
    return hash;
  }

  async get(hash: string): Promise<Uint8Array> {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid attachment fingerprint.");
    const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
    const path = requireNodeModule<typeof import("node:path")>("path");
    const bytes = new Uint8Array(await fs.readFile(path.join(this.directory, hash)));
    if (fingerprint(bytes) !== hash)
      throw new Error("The attachment is corrupt: its fingerprint does not match.");
    return bytes;
  }
}
