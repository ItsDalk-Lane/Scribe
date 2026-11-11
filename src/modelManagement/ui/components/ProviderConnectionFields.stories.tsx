import type { Meta, StoryObj } from "@/lib/story";
import { translate } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import { ModelChecklist } from "./ModelChecklist";
import {
  ProviderChatConnectionTest,
  ProviderParameterFields,
  type ProviderParameterFieldsProps,
} from "./ProviderConnectionFields";
import type { VerificationResult } from "@/modelManagement/types/runtime";
import React, { useState } from "react";

const models = [
  { id: "model-a", displayName: "通用聊天模型", limits: { context: 128000 } },
  { id: "model-b", displayName: "长文本推理模型", reasoning: true, limits: { context: 200000 } },
];
const meta = {
  title: "Settings/Provider Connection",
  component: ProviderParameterFields,
  args: { parameters: [], values: {}, onChange: () => undefined },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<ProviderParameterFieldsProps>;
export default meta;

export const ChineseParameters: StoryObj<ProviderParameterFieldsProps> = {
  args: {
    parameters: [
      { key: "GOOGLE_VERTEX_PROJECT", label: "Google Cloud 项目 ID", required: true },
      { key: "GOOGLE_VERTEX_LOCATION", label: "Google Cloud 区域", defaultValue: "global" },
    ],
    values: { GOOGLE_VERTEX_PROJECT: "知识管理项目", GOOGLE_VERTEX_LOCATION: "global" },
  },
};

export const ChineseDirectoryUnavailable: StoryObj<ProviderParameterFieldsProps> = {
  render: () => (
    <div className="tw-flex tw-flex-col tw-gap-3">
      <p className="tw-m-0 tw-text-sm tw-text-muted">
        此账号无权读取目录，仍可选择目录中的候选模型或手动填写模型 ID。
      </p>
      <ModelChecklist
        availableModels={models}
        selected={new Set(["model-a"])}
        onToggle={() => undefined}
        onAddId={() => undefined}
        fetchError="HTTP 403：此密钥没有模型目录读取权限。"
      />
      <ProviderChatConnectionTest
        models={[models[0]]}
        modelId="model-a"
        onModelChange={() => undefined}
        onTest={() => undefined}
        testing={false}
        result={null}
      />
    </div>
  ),
};

export const ChineseChatVerified: StoryObj<ProviderParameterFieldsProps> = {
  render: () => (
    <ProviderChatConnectionTest
      models={models}
      modelId="model-a"
      onModelChange={() => undefined}
      onTest={() => undefined}
      testing={false}
      result={{ ok: true, message: "模型已成功返回测试回复。", checkedAt: 0 }}
    />
  ),
};

export const ChinesePermissionDenied: StoryObj<ProviderParameterFieldsProps> = {
  render: () => (
    <ProviderChatConnectionTest
      models={models}
      modelId="model-b"
      onModelChange={() => undefined}
      onTest={() => undefined}
      testing={false}
      result={{
        ok: false,
        code: "permission_denied",
        message: "此账号未开通所选模型，请更换模型或联系供应商开通权限。原配置仍可保存。",
        checkedAt: 0,
      }}
    />
  ),
};

export const ChineseInputChanged: StoryObj<ProviderParameterFieldsProps> = {
  render: function InputChanges() {
    const [url, setUrl] = useState("https://gateway.example/v1");
    const [result, setResult] = useState<VerificationResult | null>({ ok: true, checkedAt: 0 });
    return (
      <div className="tw-flex tw-flex-col tw-gap-3">
        <p className="tw-m-0 tw-text-sm tw-text-muted">
          修改下面的地址后，之前的检查结果会清除，需要重新检查。
        </p>
        <Input
          aria-label="模型服务地址"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setResult(null);
          }}
        />
        <ProviderChatConnectionTest
          models={models}
          modelId="model-a"
          onModelChange={() => setResult(null)}
          onTest={() => setResult({ ok: true, checkedAt: 0 })}
          testing={false}
          result={result}
        />
      </div>
    );
  },
};

export const ChinesePrivacySetup: StoryObj<ProviderParameterFieldsProps> = {
  args: {
    instructions: [
      translate(
        "zh-CN",
        "Start the official Privatemode proxy before connecting to localhost:8080. The proxy handles encryption and verification; when it holds your API key, a placeholder key is enough here."
      ),
      translate(
        "zh-CN",
        "A normal Tinfoil HTTPS connection does not verify the secure enclave. For verified privacy, run the official Tinfoil proxy and use its local base URL, usually http://127.0.0.1:3301/v1."
      ),
    ],
  },
};

export const ChineseQvacAddressRequired: StoryObj<ProviderParameterFieldsProps> = {
  render: () => (
    <div className="tw-flex tw-flex-col tw-gap-3">
      <ProviderParameterFields
        parameters={[]}
        instructions={[
          translate(
            "zh-CN",
            "Enter the base URL of your running QVAC server. No default address is assumed."
          ),
        ]}
        values={{}}
        onChange={() => undefined}
      />
      <Input aria-label="QVAC 服务地址" placeholder="http://your-server:port/v1" />
      <p role="status" className="tw-m-0 tw-text-xs tw-text-muted">
        {translate("zh-CN", "A base URL is required for this provider.")}
      </p>
      <ProviderChatConnectionTest
        models={[models[0]]}
        modelId="model-a"
        onModelChange={() => undefined}
        onTest={() => undefined}
        testing={false}
        result={null}
        disabled
      />
    </div>
  ),
};

export const ChineseCohereCompatibleApi: StoryObj<ProviderParameterFieldsProps> = {
  args: { apiFormat: "compatible", onApiFormatChange: () => undefined },
};

export const ChineseCohereNativeApi: StoryObj<ProviderParameterFieldsProps> = {
  render: () => (
    <div className="tw-flex tw-flex-col tw-gap-3">
      <Input aria-label="Cohere 原生基础地址" value="https://api.cohere.com/v2" readOnly />
      <ProviderParameterFields
        parameters={[]}
        values={{}}
        onChange={() => undefined}
        apiFormat="native"
        onApiFormatChange={() => undefined}
      />
    </div>
  ),
};
