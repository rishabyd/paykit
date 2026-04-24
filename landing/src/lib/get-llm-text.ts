import type { InferPageType } from "fumadocs-core/source";

import type { source } from "@/lib/source";

export async function getLLMText(page: InferPageType<typeof source>) {
  const data = page.data as InferPageType<typeof source>["data"] &
    import("fumadocs-mdx/runtime/types").DocMethods;
  const processed = await data.getText("processed");

  return `# ${page.data.title} (${page.url})\n\n${processed}`;
}
