import { readFile } from "node:fs/promises";
import { glob } from "astro/loaders";

const LEADING_HEADING = /^#\s+(.+?)\s*$/m;

export function headingTitledGlob(options) {
  const loader = glob(options);
  return {
    ...loader,
    load: (context) =>
      loader.load({
        ...context,
        parseData: async ({ data, filePath, ...rest }) => {
          const heading = LEADING_HEADING.exec(await readFile(filePath, "utf8"))?.[1];
          const title = heading?.replaceAll("`", "");
          return context.parseData({ ...rest, filePath, data: { title, ...data } });
        },
      }),
  };
}
