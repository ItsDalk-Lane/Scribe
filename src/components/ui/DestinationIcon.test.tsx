import { DestinationIcon } from "@/components/ui/DestinationIcon";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("DestinationIcon", () => {
  describe("DestinationIcon()", () => {
    it.each([
      { kind: "cloud", label: "Example provider" },
      { kind: "local", label: "A server on this computer" },
    ] as const)(
      "names the $kind destination for https://github.com/logancyang/obsidian-copilot/issues/2889",
      (destination) => {
        render(<DestinationIcon destination={destination} />);
        expect(screen.getByText(`Sends requests to: ${destination.label}`)).toBeTruthy();
      }
    );
  });
});
