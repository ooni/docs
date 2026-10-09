/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/pages/tools/measurement-viewer.astro",
    "./src/measurement-viewer/**/*.{ts,tsx}",
    "./src/pages/tools/event-dashboard.astro",
    "./src/event-dashboard/**/*.{ts,tsx}",
    "./src/pages/tools/changepoint-labeler.astro",
    "./src/changepoint-labeler/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
