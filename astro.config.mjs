import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import vercel from '@astrojs/vercel/static';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  adapter: vercel(),
	integrations: [
		starlight({
			title: 'OONI Docs',
			social: {
				github: 'https://github.com/ooni/docs',
			},
			sidebar: [
				{
					label: 'Backend',
					autogenerate: { directory: 'backend' },
				},
			],
            expressiveCode: false
		}),
	],
});