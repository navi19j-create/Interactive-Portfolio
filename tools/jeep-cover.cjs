// Photograph the actual race scene with the game's preview camera.
// Uses the same local Chrome and Playwright settings as the other portfolio checks.
const fs = require('node:fs/promises');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require(process.env.PORTFOLIO_TEST_DRIVER || 'playwright-core');

async function main() {
  const root = path.resolve(__dirname, '..');
  const base = process.env.PORTFOLIO_TEST_URL || 'http://127.0.0.1:8317';
  const mode = process.argv[2] || 'pass-cover';
  if (!['cover', 'pass-cover'].includes(mode)) throw new Error('Choose cover or pass-cover.');
  const output = process.argv[3] ? path.resolve(process.argv[3]) :
    path.join(root, 'dist/assets/jeep-race', mode === 'pass-cover' ? 'spa-kemmel.webp' : 'spa-grid.webp');
  const geometry = await build({
    stdin: {
      contents: `
        import { createWorld } from './src/jeep/world.js';
        import { createRace } from './src/jeep/simulation.js';
        const canvas = document.querySelector('canvas');
        const world = createWorld(canvas);
        await world.ready;
        const race = createRace();
        window.photograph = mode => {
          world.render(race, 1/60, mode);
          return canvas.toDataURL('image/webp', 0.92).split(',')[1];
        };
      `,
      resolveDir: root,
    },
    bundle: true, write: false, format: 'esm',
  });
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN, headless: true,
    args: ['--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', error => console.error(error.message));
    await page.route('**/jeep-racing/__cover', route => route.fulfill({
      contentType: 'text/html',
      body: '<meta charset="utf-8"><style>*{margin:0}canvas{display:block;width:100vw;height:100vh}</style><canvas></canvas><script type="module" src="/__jeep-cover.js"></script>',
    }));
    await page.route('**/__jeep-cover.js', route => route.fulfill({
      contentType: 'text/javascript', body: geometry.outputFiles[0].text,
    }));
    await page.goto(base + '/jeep-racing/__cover');
    await page.waitForFunction(() => typeof window.photograph === 'function', null, { timeout: 60000 });
    const encoded = await page.evaluate(mode => window.photograph(mode), mode);
    await fs.mkdir(path.dirname(output), {recursive: true});
    await fs.writeFile(output, Buffer.from(encoded, 'base64'));
    console.log(output);
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
