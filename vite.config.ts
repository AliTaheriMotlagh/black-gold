import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import fs from 'node:fs';
import { loadEnv, type Plugin } from 'vite';

/** Production origin, used when VITE_SITE_URL is not set (e.g. Vercel, where .env* files are not deployed). */
const PROD_SITE_URL = 'https://black-gold-war.vercel.app';

/** Writes sitemap.xml and fills the site URL into robots.txt at build time. */
function seo(site: string): Plugin {
  return {
    name: 'seo-files',
    apply: 'build',
    closeBundle() {
      const today = new Date().toISOString().slice(0, 10);
      const urls = [
        { loc: `${site}/`, alt: [['en', `${site}/`], ['fa', `${site}/fa/`]] },
        { loc: `${site}/fa/`, alt: [['en', `${site}/`], ['fa', `${site}/fa/`]] },
      ];
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n${u.alt.map(([l, h]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${h}"/>`).join('\n')}\n  </url>`).join('\n')}
</urlset>
`;
      fs.writeFileSync('dist/sitemap.xml', xml);
      const robots = fs.readFileSync('dist/robots.txt', 'utf8').replace('https://SITE_URL_PLACEHOLDER', site);
      fs.writeFileSync('dist/robots.txt', robots);
    },
  };
}

export default defineConfig(({ mode }) => {
  // .env.development sets localhost for `npm run dev`; builds fall back to production.
  // Vite resolves %VITE_SITE_URL% in index.html from process.env too, so set it here for Vercel builds.
  const site = (loadEnv(mode, process.cwd(), '').VITE_SITE_URL || PROD_SITE_URL).replace(/\/$/, '');
  process.env.VITE_SITE_URL = site;
  return {
    base: '/',
    plugins: [seo(site)],
    server: { host: true },
    build: {
      target: 'es2022',
      sourcemap: false,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          play: resolve(__dirname, 'play/index.html'),
          fa: resolve(__dirname, 'fa/index.html'),
        },
        output: {
          manualChunks: {
            three: ['three'],
            post: ['postprocessing'],
          },
        },
      },
    },
  };
});
