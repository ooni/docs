import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import vercel from "@astrojs/vercel/static";
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
          label: "Meta",
          autogenerate: { directory: "meta" },
        },
        {
          label: "Devops",
          autogenerate: { directory: "devops" },
        },
        {
          label: "Backend",
          autogenerate: { directory: "backend" },
        },
        {
          label: "Legacy Backend",
          autogenerate: { directory: "legacybackend" },
        },
      ],
      expressiveCode: false,
    }),
  ],
  markdown: {
    rehypePlugins: [[rehypeShikiji, { theme: "github-dark" }]],
    syntaxHighlight: false,
  },
});
