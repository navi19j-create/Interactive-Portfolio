const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require(process.env.PORTFOLIO_TEST_DRIVER || 'playwright-core');
const url = (process.env.PORTFOLIO_TEST_URL || 'http://127.0.0.1:8317') + '/jeep-racing/';
const waitFor = { timeout: 45000 };

async function start(page) {
  await page.getByRole('button', {name: 'Race the Jeeps'}).click();
  await page.locator('#hud').waitFor({state: 'visible', ...waitFor});
}

async function checkTitle(page, name) {
  const aligned = await page.locator('h1').evaluate((title) => {
    const line = document.createRange();
    line.selectNodeContents(title.lastChild);
    const art = document.querySelector('.poster-art').getBoundingClientRect();
    const rect = line.getBoundingClientRect();
    return rect.right <= (rect.top < art.top ? innerWidth : art.left) + 1;
  });
  assert.ok(aligned, 'The second title line should fit on ' + name);
  if (process.env.PORTFOLIO_TEST_OUTPUT) {
    await page.screenshot({path: path.join(process.env.PORTFOLIO_TEST_OUTPUT, 'racing-' + name + '.png')});
  }
}

async function checkResults(browser) {
  const simulation = path.resolve(__dirname, '../src/jeep/simulation.js');
  const track = path.resolve(__dirname, '../src/jeep/track.js');
  const bundle = await build({
    entryPoints: [path.resolve(__dirname, '../src/jeep-racing.js')],
    bundle: true, write: false, format: 'esm',
    plugins: [{
      name: 'finish-scenario',
      setup(builder) {
        builder.onResolve({filter: /^\.\/jeep\/simulation\.js$/}, () => ({path: 'finish-scenario', namespace: 'qa'}));
        builder.onLoad({filter: /.*/, namespace: 'qa'}, () => ({
          contents: `
            import { createRace as base } from ${JSON.stringify(simulation.replaceAll('\\', '/'))};
            import { track } from ${JSON.stringify(track.replaceAll('\\', '/'))};
            export function createRace(options) {
              const race = base(options);
              window.qaFinish = () => {
                const { player } = race;
                race.phase = 'racing';
                race.startLights = 0;
                race.elapsed = 134.0;
                Object.assign(player, {
                  s: track.length * 2 - 0.1, nextGate: 24, speed: 20, offset: 0,
                  completedLaps: 1, lap: 2, lapStart: 67, bestLap: 66,
                });
              };
              window.qaPortraitTow = () => {
                race.phase = 'racing';
                race.startLights = 0;
                race.elapsed = 15;
                const straight = track.turns.find(({ name }) => name === 'Kemmel Straight').s + 18;
                Object.assign(race.player, { s: straight, speed: 24, offset: .14, heading: 0, nextGate: 3 });
                Object.assign(race.cars[1], { s: straight + 10, speed: 24, offset: .14, heading: 0 });
                race.cars[2].s = straight - 85;
                race.cars[3].s = straight - 105;
              };
              return race;
            }
          `,
          resolveDir: path.dirname(simulation),
        }));
      },
    }],
  });
  const page = await browser.newPage({viewport: {width: 1000, height: 650}});
  await page.route('**/jeep-racing.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: bundle.outputFiles[0].text,
  }));
  await page.goto(url);
  await start(page);
  await page.evaluate(() => window.qaFinish());
  await page.getByRole('heading', {name: 'Race complete'}).waitFor();
  assert.equal(await page.locator('#finish-place').textContent(), '1 / 4');
  assert.match(await page.locator('#finish-time').textContent(), /^2:14\.00\d$/);
  assert.equal(await page.locator('#best-lap').textContent(), '1:06.000');
  for (const [width, height] of [[1000, 650], [390, 844], [320, 640]]) {
    await page.setViewportSize({width, height});
    const fits = await page.getByRole('heading', {name: 'Race complete'}).evaluate((heading) => {
      const range = document.createRange();
      range.selectNodeContents(heading);
      const outer = heading.getBoundingClientRect();
      return [...range.getClientRects()].every((line) => line.right <= outer.right + 1);
    });
    assert.ok(fits, 'Result heading fits at width ' + width);
    if (process.env.PORTFOLIO_TEST_OUTPUT) {
      await page.screenshot({path: path.join(process.env.PORTFOLIO_TEST_OUTPUT, 'racing-results-' + width + '.png')});
    }
  }
  await page.getByRole('button', {name: 'Race again'}).press('Enter');
  const lights = page.locator('#start-lights');
  assert.ok(await lights.isVisible());
  assert.equal(await lights.getAttribute('data-lit'), '1');
  assert.equal(await page.locator('#lap').textContent(), '1');
  assert.equal(await page.locator('#speed').textContent(), '0');
  await page.close();
  console.log('Actual finish crossing, results and keyboard replay passed with a seeded finish scenario.');

  const portrait = await browser.newPage({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce',
  });
  await portrait.route('**/jeep-racing.js', route => route.fulfill({
    contentType: 'text/javascript', body: bundle.outputFiles[0].text,
  }));
  await portrait.goto(url);
  await start(portrait);
  await portrait.evaluate(() => window.qaPortraitTow());
  await portrait.waitForFunction(() => document.querySelector('#wake').dataset.strength === '3' &&
    document.querySelector('#wake-rival').textContent === 'Viridian', null, waitFor);
  assert.match(await portrait.locator('#wake-gap').textContent(), /^\d+ m$/);
  assert.equal(await portrait.locator('#wake').evaluate(meter => getComputedStyle(meter).transitionDuration), '0s');
  if (process.env.PORTFOLIO_TEST_OUTPUT) {
    await portrait.screenshot({
      path: path.join(process.env.PORTFOLIO_TEST_OUTPUT, 'racing-portrait-three-bar-tow-fixture.png'),
    });
  }
  await portrait.close();
  console.log('Portrait three-bar Slipstream, actual supplying rival and reduced motion passed with a controlled tow fixture.');
}

async function run() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN,
    headless: true, args: ['--enable-unsafe-swiftshader'],
  });
  try {
    const desktop = await browser.newPage({viewport: {width: 1280, height: 800}});
    const errors = [];
    desktop.on('pageerror', (error) => errors.push(error.message));
    await desktop.goto(url);
    assert.equal(await desktop.title(), 'Little Box Jeep Racing');
    const lobbySound = desktop.locator('#project [data-sound]');
    assert.equal(await lobbySound.getAttribute('aria-pressed'), 'true');
    await lobbySound.click();
    await desktop.reload();
    assert.equal(await lobbySound.getAttribute('aria-pressed'), 'false');
    await checkTitle(desktop, 'desktop');
    await desktop.setViewportSize({width: 820, height: 720});
    await checkTitle(desktop, 'midwidth');
    await desktop.setViewportSize({width: 1280, height: 800});
    await start(desktop);
    const hudSound = desktop.locator('#hud [data-sound]');
    assert.equal(await hudSound.getAttribute('aria-pressed'), 'false');
    await hudSound.click();
    assert.equal(await hudSound.getAttribute('aria-pressed'), 'true');
    assert.equal(await desktop.evaluate(() => document.activeElement.id), 'arena');
    await desktop.keyboard.press('Escape');
    assert.equal(await desktop.locator('#dialog-sound').getAttribute('aria-pressed'), 'true');
    await desktop.getByRole('heading', {name: 'Paused'}).waitFor();
    await desktop.getByRole('button', {name: 'Resume race'}).press('Enter');
    await desktop.waitForFunction(() => document.querySelector('#countdown').textContent === 'Go!', null, waitFor);
    await desktop.keyboard.down('ArrowUp');
    await desktop.keyboard.press('Space');
    await desktop.waitForFunction(() => document.querySelector('#boost-state').textContent === 'Active');
    await desktop.keyboard.down('ArrowDown');
    await desktop.waitForFunction(() => document.querySelector('#boost-state').textContent.endsWith('s'));
    await desktop.keyboard.up('ArrowDown');
    await desktop.keyboard.up('ArrowUp');
    await desktop.keyboard.press('Escape');
    await desktop.getByRole('button', {name: 'Back to project'}).click();
    await start(desktop);
    await desktop.keyboard.press('Escape');
    await desktop.getByRole('button', {name: 'Back to project'}).click();
    assert.deepEqual(errors, []);
    console.log('Desktop launch, pause, resume, accelerate, boost, brake, exit and reentry passed.');
    await desktop.close();

    const mobile = await browser.newPage({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});
    await mobile.goto(url);
    await checkTitle(mobile, 'phone');
    await mobile.setViewportSize({width: 320, height: 720});
    await checkTitle(mobile, '320');
    assert.ok(await mobile.locator('body').evaluate(body => body.scrollWidth <= innerWidth));
    await start(mobile);
    await mobile.getByRole('button', {name: 'Steer left'}).waitFor();
    const portraitLights = mobile.locator('#start-lights');
    const lightsBox = await portraitLights.boundingBox();
    const controlsBox = await mobile.locator('.controls').boundingBox();
    const meterBox = await mobile.locator('.race-meters').boundingBox();
    assert.ok(controlsBox.width <= 320);
    const soundBox = await mobile.locator('#hud [data-sound]').boundingBox();
    assert.ok(soundBox && soundBox.width >= 44 && soundBox.x >= 0 && soundBox.x + soundBox.width <= 320);
    assert.ok(soundBox.x >= meterBox.x + meterBox.width || soundBox.y >= meterBox.y + meterBox.height);
    const mapBox = await mobile.locator('#minimap').boundingBox();
    assert.ok(soundBox.y >= mapBox.y + mapBox.height || soundBox.y + soundBox.height <= mapBox.y);
    assert.ok(lightsBox.y + lightsBox.height < controlsBox.y && meterBox.y + meterBox.height < lightsBox.y);
    if (process.env.PORTFOLIO_TEST_OUTPUT) {
      await mobile.screenshot({path: path.join(process.env.PORTFOLIO_TEST_OUTPUT, 'racing-portrait-grid.png')});
    }
    await mobile.waitForFunction(() => document.querySelector('#countdown').textContent === 'Go!', null, waitFor);
    const cdp = await mobile.context().newCDPSession(mobile);
    async function point(selector, id) {
      const rect = await mobile.locator(selector).boundingBox();
      return { id, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }
    const steering = await point('#left', 1);
    const boost = await point('#boost', 2);
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [steering]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [steering, boost]});
    await mobile.waitForFunction(() => document.querySelector('#boost-state').textContent === 'Active' &&
      document.querySelector('#left').dataset.held === 'true');
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    console.log('Portrait two-pointer steering and Overtake passed.');
    await mobile.close();

    const fallback = await browser.newPage();
    await fallback.route('**/little-box.glb', (route) => route.abort('failed'));
    await fallback.goto(url);
    await fallback.getByRole('button', {name: 'Race the Jeeps'}).click();
    await fallback.getByRole('heading', {name: '3D unavailable'}).waitFor(waitFor);
    assert.ok(await fallback.getByRole('link', {name: 'Watch the showcase'}).last().isVisible());
    await fallback.getByRole('button', {name: 'Back to project'}).click();
    console.log('Failed 3D asset fallback and return passed.');
    await fallback.close();
    await checkResults(browser);
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});



