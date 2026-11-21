// Collect the grid, chase view and device measurements from the deployed browser entry point.
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PORTFOLIO_TEST_DRIVER || 'playwright-core');
const base = process.env.PORTFOLIO_TEST_URL || 'http://127.0.0.1:8317';
const output = process.env.PORTFOLIO_TEST_OUTPUT || require('node:os').tmpdir();

async function inspect(browser, mobile) {
  const name = mobile ? 'touch' : 'desktop';
  const page = await browser.newPage({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    hasTouch: mobile, isMobile: mobile, deviceScaleFactor: mobile ? 2 : 1,
  });
  try {
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400) failures.push(response.status() + ' ' + response.url());
    });
    let galleryOffset;
    if (mobile) {
      await page.goto(base + '/jeep-racing/');
    } else {
      await page.goto(base + '/');
      const projectLink = page.getByRole('link', { name: 'Race the Jeeps', exact: true });
      await projectLink.scrollIntoViewIfNeeded();
      galleryOffset = await page.evaluate(() => scrollY);
      await projectLink.click();
    }
    await page.locator('#cover').evaluate(image => image.decode());
    await page.screenshot({ path: path.join(output, name + '-project.png') });
    await page.getByRole('button', { name: 'Race the Jeeps' }).click();
    await page.locator('#hud').waitFor();
    const hardware = await page.locator('canvas').evaluate(canvas => {
      const gl = canvas.getContext('webgl2');
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    });
    await page.waitForFunction(() => {
      const lights = document.querySelector('#start-lights');
      return lights ? lights.getBoundingClientRect().width > 0 : document.querySelector('#hud').hidden === false;
    });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(output, name + '-grid.png') });
    await page.keyboard.down('w');
    await page.waitForFunction(() => Number(document.querySelector('#speed').textContent) > 18, null, { timeout: 45000 });
    await page.getByRole('button', { name: /Overtake/i }).click();
    await page.waitForFunction(() => document.querySelector('#boost-state').textContent === 'Active');
    await page.screenshot({ path: path.join(output, name + '-race.png') });
    const metrics = await page.evaluate(async () => {
      const intervals = [];
      const started = performance.now();
      let last = started;
      await new Promise(resolve => requestAnimationFrame(function sample(now) {
        if (last !== started) intervals.push(now - last);
        last = now;
        if (now - started < 5000) requestAnimationFrame(sample);
        else resolve();
      }));
      const elapsed = intervals.reduce((sum, dt) => sum + dt, 0);
      intervals.sort((a, b) => a - b);
      const resources = performance.getEntriesByType('resource');
      return {
        frames: intervals.length,
        fps: Math.round(1000 * intervals.length / elapsed),
        p95FrameMs: Math.round(intervals[Math.floor(intervals.length * 0.95)]),
        resourceMiB: +(resources.reduce((bytes, item) => bytes + item.transferSize, 0) / 1048576).toFixed(2),
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    await page.keyboard.up('w');
    if (!mobile) {
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Back to project' }).click();
      const cdp = await page.context().newCDPSession(page);
      const heapAfterExit = [];
      for (let run = 0; run < 3; run++) {
        await page.getByRole('button', { name: 'Race the Jeeps' }).click();
        await page.locator('#hud').waitFor();
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Back to project' }).click();
        await cdp.send('HeapProfiler.collectGarbage');
        const heap = await cdp.send('Runtime.getHeapUsage');
        heapAfterExit.push(+(heap.usedSize / 1048576).toFixed(2));
      }
      metrics.jsHeapMiBAfterExit = heapAfterExit;
      await page.getByRole('link', { name: 'All work' }).click();
      await page.waitForURL(base + '/');
      await page.waitForFunction(offset => Math.abs(scrollY - offset) <= 3, galleryOffset);
    }
    console.log(JSON.stringify({ name, hardware, ...metrics, failures }));
    if (failures.length || metrics.horizontalOverflow) process.exitCode = 1;
  } finally {
    await page.close();
  }
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN, headless: true,
    args: ['--enable-unsafe-swiftshader'],
  });
  try {
    await inspect(browser, false);
    await inspect(browser, true);
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
