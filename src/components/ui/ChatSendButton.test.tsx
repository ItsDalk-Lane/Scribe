import { ChatSendButton } from "@/components/ui/ChatSendButton";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
describe("ChatSendButton", () => {
  describe("ChatSendButton", () => {
    it("disables a nonempty draft when sending is unavailable (https://github.com/ItsDalk-Lane/Scribe/issues/21)", () => {
      const onSend = jest.fn();
      render(
        <ChatSendButton inputMessage="Keep this draft" imageCount={1} onSend={onSend} disabled />
      );
      const button = screen.getByRole<HTMLButtonElement>("button", { name: "Send" });
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      expect(onSend).not.toHaveBeenCalled();
    });
    it.each([
      ["", 0, true],
      [" ", 1, false],
      ["Explain", 0, false],
    ])("renders draft %p with %p images with disabled=%p", (input, count, disabled) => {
      const onSend = jest.fn();
      render(<ChatSendButton inputMessage={input} imageCount={count} onSend={onSend} />);
      const button = screen.getByRole<HTMLButtonElement>("button", { name: "Send" });
      expect(button.disabled).toBe(disabled);
      fireEvent.click(button);
      expect(onSend).toHaveBeenCalledTimes(disabled ? 0 : 1);
    });
  });
});
