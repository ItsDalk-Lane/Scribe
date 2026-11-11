import { render } from "@testing-library/react";
import * as React from "react";
import { createGalleryCatalog } from "./Gallery";
import * as stories from "@/components/modals/ConfirmModal.stories";

describe("ConfirmModal.stories", () => {
  describe("StartupFailure", () => {
    it("renders the real report example and confirmation button in the gallery", () => {
      const catalog = createGalleryCatalog(
        [{ componentId: "@/components/modals/ConfirmModal", storyModule: stories }],
        1
      );
      const story = catalog.stories.find((item) => item.id === "Modal/Confirm/StartupFailure");
      expect(story).toMatchObject({ host: "modal", layout: "padded" });
      if (!story) throw new Error("Missing startup failure story");
      const gallery = render(<>{story.render()}</>);
      expect(gallery.container.querySelector(".tw-whitespace-pre-wrap")?.textContent).toBe(
        stories.StartupFailure.args?.content
      );
      expect(gallery.getByRole("button", { name: "Done" })).toBeTruthy();
    });
  });
});
