import type { z } from "zod";

import type { ProviderType } from "@/modelManagement/types/catalog";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";
import type { VerificationResult } from "@/modelManagement/types/runtime";

export interface AdapterVerifyContext<TExtras = unknown> {
  provider: Provider;
  apiKey: string | null;
  extras: TExtras;
  probeModel?: ConfiguredModel;
}

export interface ProviderAdapter<TExtras = unknown> {
  readonly providerType: ProviderType;

  readonly extrasSchema: z.ZodType<TExtras>;

  verifyCredentials(ctx: AdapterVerifyContext<TExtras>): Promise<VerificationResult>;
}
