import { DestinationIcon } from "@/components/ui/DestinationIcon";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("DestinationIcon", () => {
  describe("DestinationIcon", () => {
    it.each([
      { kind: "cloud", label: "Example provider" },
      { kind: "local", label: "A server on this computer" },
    ] as const)("names the $kind destination", (destination) => {
      render(<DestinationIcon destination={destination} />);
      expect(screen.getByText(`Sends requests to: ${destination.label}`)).toBeTruthy();
    });
  });
});
