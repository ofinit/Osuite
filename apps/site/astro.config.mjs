// Marketing website for https://osuite.business. Static pages; prices and
// business details are read from the admin API at build time and refreshed in
// the browser (see src/lib/site.ts and src/scripts/live-data.ts).
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://osuite.business',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [sitemap()],
});
