import type { Meta, StoryObj } from "@/lib/story";
import { SecretUnlockForm, type SecretUnlockFormProps } from "@/services/ui/SecretUnlockForm";

const meta = {
  title: "Settings/Secret unlock",
  component: SecretUnlockForm,
  parameters: { gallery: { host: "modal", layout: "padded" } },
  args: { onSubmit: async () => {}, onReset: async () => {}, onCancel: () => {} },
} satisfies Meta<SecretUnlockFormProps>;
export default meta;
type Story = StoryObj<SecretUnlockFormProps>;
export const Create: Story = { args: { creating: true } };
export const Unlock: Story = { args: { creating: false } };
export const WrongPassword: Story = {
  args: {
    creating: false,
    onSubmit: async () => {
      throw new Error("主密码不正确，原文件未被修改。");
    },
  },
};
