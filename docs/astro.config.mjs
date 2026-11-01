import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import { remarkPublishedDocs } from "./src/remark-published-docs.mjs";

// Existing guide routes stay stable while section links make the most important
// workflows visible without splitting their source files.
const sidebar = [
  { label: "Start here", items: [{ slug: "" }, { slug: "getting-started" }] },
  {
    label: "Agent Chat",
    items: [
      { label: "Agent Chat overview", link: "/agent-mode-and-tools/" },
      { label: "Set up Claude", link: "/agent-mode-and-tools/#set-up-claude" },
      { label: "Skills with Claude", link: "/agent-mode-and-tools/#skills-with-claude" },
      { slug: "projects" },
      { slug: "context-and-mentions" },
      { slug: "system-prompts" },
      { slug: "agents-md-examples" },
      { slug: "agent-mode-windows-setup" },
    ],
  },
  {
    label: "Everyday tools",
    items: [{ slug: "custom-commands" }],
  },
  {
    label: "Models",
    items: [
      { label: "Providers and BYOK", link: "/llm-providers/" },
      { label: "Model selection", link: "/models-and-parameters/" },
    ],
  },
  {
    label: "Settings",
    items: [
      { label: "Settings overview", link: "/settings/" },
      { label: "General", link: "/settings/#general" },
      { label: "Models", link: "/settings/#models" },
      { label: "Skills", link: "/settings/#skills" },
      { label: "Command", link: "/settings/#command" },
    ],
  },
  {
    label: "Help and reference",
    items: [{ slug: "troubleshooting-and-faq" }],
  },
];

export default defineConfig({
  site: "https://docs.obsidiancopilot.com",
  markdown: { remarkPlugins: [remarkPublishedDocs] },
  integrations: [
    starlight({
      title: "Scribe for Obsidian",
      markdown: { processedDirs: ["."] },
      favicon: "/favicon.svg",
      logo: {
        dark: "./src/assets/scribe-mark.svg",
        light: "./src/assets/scribe-icon.svg",
        alt: "",
      },
      components: {
        Head: "./src/components/Head.astro",
      },
      sidebar,
    }),
  ],
});
