// Renders the brand mark to a 1024px PNG for `tauri icon` (uses installed Edge).
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 26 26">
  <rect x="1" y="1" width="24" height="24" rx="5" fill="#ffffff" stroke="#cfd4dd" stroke-width="0.6"/>
  <line x1="8" y1="1.6" x2="8" y2="24.4" stroke="#a3141b" stroke-width="1.5"/>
  <circle cx="15.5" cy="13" r="5" fill="none" stroke="#1a2233" stroke-width="2.2"/>
</svg>`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.locator('svg').screenshot({ path: resolve(import.meta.dirname, '../apps/desktop/icon-source.png'), omitBackground: true });
await browser.close();
console.log('wrote apps/desktop/icon-source.png');
