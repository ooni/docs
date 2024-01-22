import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import vercel from "@astrojs/vercel/static";
import rehypeMermaid from "rehype-mermaid";
import rehypeShikiji from "rehype-shikiji";

// https://astro.build/config
export default defineConfig({
  output: "static",
  adapter: vercel(),
  integrations: [
    starlight({
      title: "OONI Docs",
      social: {
        github: "https://github.com/ooni/docs",
      },
      sidebar: [
        {
          label: "Backend",
          autogenerate: { directory: "backend" },
        },
      ],
      expressiveCode: false,
    }),
  ],
  markdown: {
    rehypePlugins: [rehypeMermaid, [rehypeShikiji, { theme: "github-dark" }]],
    syntaxHighlight: false,
  },
});
