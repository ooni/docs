import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightOpenAPI, { openAPISidebarGroups } from 'starlight-openapi'
import vercel from "@astrojs/vercel/static";

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
      plugins: [
        // Generate the OpenAPI documentation pages.
        starlightOpenAPI([
          {
           base: 'api-oonirun',
           label: 'OONI Run API',
           schema: './schemas/oonirun.json',
          },
          {
           base: 'api-oonifindings',
           label: 'OONI Findings API',
           schema: './schemas/oonifindings.json',
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
          label: "Legacy Backend",
          autogenerate: {
            directory: "legacybackend",
          },
        },
        ...openAPISidebarGroups
      ],
      customCss: ["./src/styles/custom.css"],
    }),
  ]
});
