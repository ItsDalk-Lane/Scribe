import { fireEvent, render, screen } from "@testing-library/react";
import { setInterfaceLocale } from "@/lib/i18n";
import React from "react";
import { ProviderChatConnectionTest, ProviderParameterFields } from "./ProviderConnectionFields";

const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/1";

describe("ProviderConnectionFields", () => {
  describe("ProviderParameterFields", () => {
    it(`shows current public parameters and forwards a field edit without changing other values (${issue})`, () => {
      const onChange = jest.fn();
      const values = { region: "eu", unknown: "keep" };
      render(
        <ProviderParameterFields
          parameters={[
            { key: "region", label: "Region", required: true },
            { key: "location", label: "Location", defaultValue: "global" },
          ]}
          values={values}
          onChange={onChange}
        />
      );
      expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Location" }).value).toBe(
        "global"
      );
      fireEvent.change(screen.getByRole("textbox", { name: "Region" }), {
        target: { value: "us" },
      });
      expect(onChange).toHaveBeenCalledWith("region", "us");
      expect(values).toEqual({ region: "eu", unknown: "keep" });
    });

    it(`shows Chinese profile labels and guidance while retaining the user's parameter value (${issue})`, () => {
      setInterfaceLocale("zh-CN");
      try {
        render(
          <ProviderParameterFields
            parameters={[{ key: "project", label: "Google Cloud project ID" }]}
            values={{ project: "my-project-$&" }}
            onChange={jest.fn()}
            instructions={[
              "Enter the base URL of your running QVAC server. No default address is assumed.",
            ]}
          />
        );
        expect(
          screen.getByRole<HTMLInputElement>("textbox", { name: "Google Cloud 项目 ID" }).value
        ).toBe("my-project-$&");
        expect(
          screen.getByText("请输入已启动的 QVAC 服务的基础地址，插件不会猜测默认地址。")
        ).toBeTruthy();
      } finally {
        setInterfaceLocale("en");
      }
    });

    it(`offers the explicit API format values without translating the saved identifiers (${issue})`, () => {
      const onApiFormatChange = jest.fn();
      const props = {
        parameters: [],
        values: {},
        onChange: jest.fn(),
        apiFormat: "compatible" as const,
        onApiFormatChange,
      };
      const { rerender } = render(<ProviderParameterFields {...props} />);
      const selector = screen.getByRole<HTMLSelectElement>("combobox", { name: "API format" });
      expect(selector.value).toBe("compatible");
      fireEvent.change(selector, { target: { value: "native" } });
      expect(onApiFormatChange).toHaveBeenCalledWith("native");
      rerender(<ProviderParameterFields {...props} disabled />);
      expect(selector.disabled).toBe(true);
    });

    it(`disables public parameters while a save is pending (${issue})`, () => {
      render(
        <ProviderParameterFields
          parameters={[{ key: "region", label: "Region" }]}
          values={{}}
          onChange={jest.fn()}
          disabled
        />
      );
      expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Region" }).disabled).toBe(true);
    });
  });

  describe("ProviderChatConnectionTest", () => {
    it(`lets the user choose a model and explicitly start a chat test (${issue})`, () => {
      const onTest = jest.fn(),
        onModelChange = jest.fn();
      render(
        <ProviderChatConnectionTest
          models={[
            { id: "a", displayName: "First" },
            { id: "b", displayName: "Second" },
          ]}
          modelId="a"
          onModelChange={onModelChange}
          onTest={onTest}
          testing={false}
          result={null}
        />
      );
      expect(onTest).not.toHaveBeenCalled();
      fireEvent.change(screen.getByRole("combobox", { name: "Test model" }), {
        target: { value: "b" },
      });
      expect(onModelChange).toHaveBeenCalledWith("b");
      fireEvent.click(screen.getByRole("button", { name: "Test chat connection" }));
      expect(onTest).toHaveBeenCalledTimes(1);
    });

    it(`cannot send a second test while waiting and keeps the provider's permission detail visible (${issue})`, () => {
      const props = {
        models: [{ id: "a", displayName: "First" }],
        modelId: "a",
        onModelChange: jest.fn(),
        onTest: jest.fn(),
      };
      const { rerender } = render(<ProviderChatConnectionTest {...props} testing result={null} />);
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Testing chat connection…" }).disabled
      ).toBe(true);
      rerender(
        <ProviderChatConnectionTest
          {...props}
          testing={false}
          result={{
            ok: false,
            code: "permission_denied",
            message: "This account cannot use First",
            checkedAt: 1,
          }}
        />
      );
      expect(screen.getByRole("status").textContent).toBe("This account cannot use First");
      expect(screen.getByText("Access restricted")).toBeTruthy();
    });

    it(`translates its own Chinese chat status while preserving the service's original error (${issue})`, () => {
      setInterfaceLocale("zh-CN");
      try {
        render(
          <ProviderChatConnectionTest
            models={[{ id: "model", displayName: "我的模型" }]}
            modelId="model"
            onModelChange={jest.fn()}
            onTest={jest.fn()}
            testing={false}
            result={{
              ok: false,
              code: "permission_denied",
              message: "Original service message: denied",
              checkedAt: 1,
            }}
          />
        );
        expect(screen.getByRole("button", { name: "测试聊天连接" })).toBeTruthy();
        expect(screen.getByText("访问受限")).toBeTruthy();
        expect(screen.getByRole("status").textContent).toBe("Original service message: denied");
      } finally {
        setInterfaceLocale("en");
      }
    });

    it(`asks for a model before allowing a test (${issue})`, () => {
      render(
        <ProviderChatConnectionTest
          models={[]}
          modelId=""
          onModelChange={jest.fn()}
          onTest={jest.fn()}
          testing={false}
          result={null}
        />
      );
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Test chat connection" }).disabled
      ).toBe(true);
      expect(screen.getByText("Select a chat model before testing this connection.")).toBeTruthy();
    });
  });
});
