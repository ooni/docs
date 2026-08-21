import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightOpenAPI, { openAPISidebarGroups } from "starlight-openapi";
import vercel from "@astrojs/vercel/static";
import react from "@astrojs/react";
import tailwind from "@astrojs/tailwind";
import { mermaid } from "./src/plugins/mermaid";

// https://astro.build/config
export default defineConfig({
  output: "static",
  adapter: vercel(),
  vite: {
    server: {
      // The measurement API only allows CORS from *.ooni.org origins, so in
      // dev we proxy /api to a locally running oonimeasurements instance.
      proxy: {
        "/api": {
          target: process.env.OONI_API_PROXY || "http://localhost:8000",
          changeOrigin: true,
        },
      },
    },
  },
  markdown: {
    remarkPlugins: [mermaid],
  },
  integrations: [
    starlight({
      title: "OONI Docs",
      social: {
        github: "https://github.com/ooni/docs",
      },
      components: {
        PageFrame: "./src/components/PageFrame.astro",
      },
      plugins: [
        // Generate the OpenAPI documentation pages.
        starlightOpenAPI([
          {
            base: "api-oonirun",
            label: "OONI Run API",
            schema: "./schemas/oonirun.json",
          },
          {
            base: "api-oonifindings",
            label: "OONI Findings API",
            schema: "./schemas/oonifindings.json",
          },
        ]),
      ],
      sidebar: [
        {
          label: "Data",
          autogenerate: {
            directory: "data",
          },
        },
        {
          label: "Meta",
          autogenerate: {
            directory: "meta",
          },
        },
        {
          label: "Devops",
          autogenerate: {
            directory: "devops",
          },
        },
        {
          label: "Backend",
          autogenerate: {
            directory: "backend",
          },
        },
        {
          label: "Probe Engine",
          autogenerate: {
            directory: "probe-engine",
          },
        },
        {
          label: "Probe App",
          autogenerate: {
            directory: "probe-multiplatform",
          },
        },
        ...openAPISidebarGroups,
      ],
      customCss: ["./src/styles/custom.css"],
    }),
    react(),
    // Base styles are kept off so tailwind does not restyle the starlight
    // docs pages; the measurement-viewer css pulls in the directives itself.
    tailwind({ applyBaseStyles: false }),
  ],
});
