import { defineCollection } from "astro:content";
import { docsSchema } from "@astrojs/starlight/schema";
import { headingTitledGlob } from "./docs-loader.mjs";

export const collections = {
  docs: defineCollection({
    loader: headingTitledGlob({ base: ".", pattern: ["*.md", "!README.md"] }),
    schema: docsSchema(),
  }),
};
