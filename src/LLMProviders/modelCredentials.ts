import type { CustomModel } from "@/aiParams";
import { RequestRedactor } from "@/LLMProviders/requestRedaction";
import { SecretStore } from "@/services/secretStore";

export async function withModelCredentials<T>(
  model: CustomModel,
  execute: (requestModel: CustomModel) => Promise<T>
): Promise<T> {
  const request = async (requestModel: CustomModel) => {
    try {
      return await execute(requestModel);
    } catch (error) {
      throw new RequestRedactor([requestModel.apiKey ?? ""]).error(error);
    }
  };
  if (!model.credentialRef || model.apiKey) return request(model);
  return SecretStore.getInstance().withSecret(model.credentialRef, async (apiKey) =>
    request({ ...model, apiKey, credentialRef: undefined })
  );
}
