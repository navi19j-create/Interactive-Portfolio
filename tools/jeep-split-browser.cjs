const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require(process.env.PORTFOLIO_TEST_DRIVER || 'playwright-core');

const base = (process.env.PORTFOLIO_TEST_URL || 'http://127.0.0.1:8317') + '/jeep-racing/';
const output = process.env.PORTFOLIO_TEST_OUTPUT;
const modes = ['chase', 'isometric', 'miniature'];
const camera = '#hud select[data-camera]';
const driver = n => '[data-player-hud="' + n + '"]';
const wait = { timeout: 45000 };

async function shot(page, name) {
  if (!output) return;
  await fs.mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, name + '.png') });
}

async function go(page, id) {
  await page.locator('#' + id).click();
  await page.locator('#hud').waitFor({ state: 'visible', ...wait });
}

async function exitRace(page) {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Back to project' }).click();
}

async function checkSlipstream(page, split) {
  const panes = split ? [driver(1) + ' [data-driver-wake]', driver(2) + ' [data-driver-wake]'] : ['#wake'];
  for (const [index, pane] of panes.entries()) {
    await page.evaluate(index => {
      const { cars, players } = window.qaRace;
      const supplier = cars[2];
      players.forEach(car => Object.assign(car, { towRivalId: null, towGap: null, wake: 0 }));
      const car = players[index];
      Object.assign(car, { towRivalId: supplier.id, towGap: supplier.s - car.s, offset: supplier.offset, wake: 0.06 });
    }, index);
    await page.locator(pane + '[data-visible=true]').waitFor(wait);
    if (split) assert.equal(await page.locator(panes[1 - index]).getAttribute('data-visible'), 'false');
    await page.evaluate(index => { window.qaRace.players[index].wake = 0.85; }, index);
    await page.waitForTimeout(350);
    await shot(page, split ? 'Slipstream player ' + (index + 1) : 'Slipstream chase');
    if (split) {
      const bounds = await page.locator(driver(index + 1)).boundingBox();
      const cue = await page.locator(pane).boundingBox();
      assert.ok(cue.x >= bounds.x - 1 && cue.x + cue.width <= bounds.x + bounds.width + 1,
        'The slipstream cue fits inside the drafting driver’s pane');
    } else {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const looping = await page.locator(pane).evaluate(el => el.getAnimations({ subtree: true })
        .some(animation => animation.effect.getTiming().iterations === Infinity && animation.playState === 'running'));
      assert.equal(looping, false, 'Reduced motion keeps the active cue legible and still');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      for (const mode of ['isometric', 'miniature']) {
        await page.locator(camera).selectOption(mode);
        await page.waitForTimeout(350);
        assert.equal(await page.locator(pane).getAttribute('data-visible'), 'true');
        await shot(page, 'Slipstream ' + mode);
      }
      await page.locator(camera).selectOption('chase');
    }
    // Wake strength decays after a pass even though the tow ribbons have ended.
    await page.evaluate(index => { window.qaRace.players[index].towRivalId = null; }, index);
    await page.waitForFunction(sel => document.querySelector(sel).dataset.visible === 'false', pane, wait);
  }
}

async function checkSplitInstruments(page) {
  const remainingBoost = await page.evaluate(() => window.qaBotAttack());
  assert.ok(remainingBoost > 0, 'The opponent spends its own charge to attack on Kemmel');
  await page.waitForTimeout(350);
  await shot(page, 'Bot attack on Kemmel');
  // Two different speeds and charge levels make swapped or mirrored controls visible.
  await page.evaluate(() => {
    const [first, second] = window.qaRace.players;
    Object.assign(first, { speed: 30, boostTime: 0, recharge: 0 });
    Object.assign(second, { speed: 25, boostTime: 0, recharge: 4.2 });
  });
  await page.waitForFunction(selector => document.querySelector(selector).textContent === '108',
    driver(1) + ' [data-driver-speed]', wait);
  for (const [width, height] of [[1280, 760], [900, 540], [844, 390], [390, 844], [320, 640]]) {
    await page.setViewportSize({ width, height });
    for (const [index, speed] of ['108', '90'].entries()) {
      const pane = page.locator(driver(index + 1));
      const button = pane.getByRole('button', { name: /overtake/i });
      await button.waitFor(wait);
      assert.equal(await pane.locator('[data-driver-speed]').innerText(), speed);
      assert.equal(await button.getAttribute('data-state'), index ? 'charging' : 'ready');
      const clipped = await pane.evaluate(el => {
        const frame = el.getBoundingClientRect();
        return ['speed', 'position', 'boost', 'boost-state', 'boost-key'].filter(name => {
          const box = el.querySelector('[data-driver-' + name + ']').getBoundingClientRect();
          return !box.width || !box.height || box.left < frame.left - 1 || box.top < frame.top - 1 ||
            box.right > frame.right + 1 || box.bottom > frame.bottom + 1;
        });
      });
      assert.deepEqual(clipped, [], 'Driver ' + (index + 1) + ' instruments fit at ' + width + '×' + height);
      const target = await button.evaluate(el => {
        const b = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2));
      });
      assert.ok(target, 'Overtake is unobstructed for driver ' + (index + 1));
    }
    if (width === 1280 || width === 390) await shot(page, 'Race dashboard ' + width);
  }
  await page.setViewportSize({ width: 1280, height: 760 });
  // Use the real input handlers and let the simulation consume each request.
  await page.evaluate(() => {
    window.qaRace.players[1].recharge = 0;
    window.qaStill = false;
  });
  for (const index of [1, 2]) {
    const button = page.locator(driver(index)).getByRole('button', { name: /overtake/i });
    await button.click();
    await page.waitForFunction(selector => document.querySelector(selector).dataset.state === 'active',
      driver(index) + ' [data-driver-boost]', wait);
    if (index === 1) assert.equal(await page.locator(driver(2) + ' [data-driver-boost]').getAttribute('data-state'), 'ready');
  }
}

async function live(page) {
  await page.goto(base);
  await go(page, 'launch-trial');
  await page.locator('#hud [data-mode=arcade]').click();
  await exitRace(page);
  await go(page, 'launch-split');
  assert.equal(await page.locator('#hud [data-mode]:visible').count(), 0);
  const grid = await page.locator(driver(1) + ' [data-driver-position]').innerText();
  await page.waitForFunction(s => document.querySelector(s).hidden, driver(1) + ' [data-driver-lights]', wait);
  await page.keyboard.down('w');
  await page.waitForFunction(s => parseFloat(document.querySelector(s).textContent) > 12,
    driver(1) + ' [data-driver-speed]', wait);
  assert.equal(parseFloat(await page.locator(driver(2) + ' [data-driver-speed]').innerText()), 0);
  await page.keyboard.down('ArrowUp');
  await page.keyboard.press('Enter');
  await page.waitForFunction(s => /active/i.test(document.querySelector(s).textContent + ' ' + document.querySelector(s).dataset.state),
    driver(2) + ' [data-driver-boost]', wait);
  await page.keyboard.press('q');
  await page.waitForFunction(s => /active/i.test(document.querySelector(s).textContent + ' ' + document.querySelector(s).dataset.state),
    driver(1) + ' [data-driver-boost]', wait);
  await page.keyboard.up('w');
  await page.keyboard.up('ArrowUp');
  await page.locator(camera).selectOption('isometric');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#screen select[data-camera]').inputValue(), 'isometric');
  assert.equal(await page.locator('#screen [data-mode]:visible').count(), 0);
  await page.locator('#screen [data-restart]').click();
  assert.equal(await page.locator(driver(1) + ' [data-driver-position]').innerText(), grid);
  await page.locator(camera).selectOption('miniature');
  await page.setViewportSize({ width: 600, height: 850 });
  await shot(page, 'Split portrait');
  await exitRace(page);
  await go(page, 'launch');
  assert.equal(await page.locator('#hud [data-mode]:visible').count(), 0);
  await exitRace(page);
  await go(page, 'launch-trial');
  assert.equal(await page.locator('#hud [data-mode=arcade]').getAttribute('aria-pressed'), 'true');
  await exitRace(page);
}

// Use the real game for input testing. This second run moves the field to
// one fixed corner for comparable images and has P2 cross the line first.
async function fixture(page) {
  const src = path.resolve(__dirname, '../src');
  const bundle = await build({
    entryPoints: [path.join(src, 'jeep-racing.js')], format: 'esm', bundle: true, write: false,
    plugins: [{ name: 'race-placement', setup(builder) {
      builder.onResolve({ filter: /^\.\/jeep\/simulation\.js$/ }, () => ({ path: 'fixture', namespace: 'qa' }));
      builder.onLoad({ filter: /.*/, namespace: 'qa' }, () => ({
        resolveDir: src,
        contents: `
          import { createRace as create } from ${JSON.stringify(path.join(src, 'jeep/simulation.js').replaceAll('\\', '/'))};
          import { track } from './jeep/track.js';
          export function createRace(options) {
            const race = create(options);
            window.qaRace = race;
            const step = race.step.bind(race);
            race.step = (...inputs) => { if (!window.qaStill) step(...inputs); };
            window.qaCorner = () => {
              window.qaStill = true;
              race.phase = 'racing';
              race.startLights = 0;
              race.elapsed = 27;
              const s = track.turns.find(t => t.name === 'Eau Rouge').s - 6;
              race.cars.forEach((car, i) => Object.assign(car, {
                s: s + [0, 7, 17, 30][i], offset: [-1, 1, -.5, 1][i], speed: 24, heading: 0,
              }));
            };
            window.qaBotAttack = () => {
              const kemmel = track.turns.find(t => t.name === 'Kemmel Straight').s + 24;
              // P1 follows the attack while P2 defends the opposite lane.
              const grid = [[-15, 0, 25], [9, 2.35, 24], [0, -2.35, 25], [-95, 0, 23]];
              race.cars.forEach((car, i) => {
                const [gap, offset, speed] = grid[i];
                Object.assign(car, { s: kemmel + gap, offset, speed, heading: 0, passing: null,
                  boostTime: 0, recharge: 0, boostHeld: false });
              });
              // Advance both human throttles and let the normal opponent AI choose its input.
              for (let i = 0; i < 42; i++) step(1 / 60, { throttle: 0.6 }, { throttle: 0.6 });
              return race.cars[2].boostTime;
            };
            window.qaFinish = i => {
              window.qaStill = false;
              Object.assign(race.players[i], { s: track.length * 2 - .1, nextGate: 24,
                speed: 20, heading: 0, offset: 0, completedLaps: 1, lap: 2, lapStart: 10 });
            };
            return race;
          }
        `,
      }));
    }}],
  });
  await page.route('**/jeep-racing.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
  await page.goto(base);
  await go(page, 'launch-trial');
  await page.locator('#hud [data-mode=arcade]').click();
  assert.equal(await page.evaluate(() => window.qaRace.collisionMode), 'arcade');
  await exitRace(page);
  for (const id of ['launch', 'launch-split']) {
    await go(page, id);
    assert.equal(await page.evaluate(() => window.qaRace.collisionMode), 'breakaway');
    await page.evaluate(() => window.qaCorner());
    await page.locator(camera).selectOption('chase');
    await checkSlipstream(page, id === 'launch-split');
    await page.evaluate(() => window.qaCorner());
    for (const mode of modes) {
      await page.locator(camera).selectOption(mode);
      await page.waitForTimeout(350);
      await shot(page, (id === 'launch' ? 'Camera ' : 'Split ') + mode);
    }
    if (id === 'launch') await exitRace(page);
    else {
      await page.locator(camera).selectOption('chase');
      await checkSplitInstruments(page);
    }
  }
  await page.evaluate(() => window.qaFinish(1));
  await page.waitForFunction(() => window.qaRace.player2.finishTime !== null);
  assert.equal(await page.evaluate(() => window.qaRace.phase), 'racing');
  await page.evaluate(() => window.qaFinish(0));
  await page.getByRole('heading', { name: 'Race complete' }).waitFor(wait);
  await shot(page, 'Split results');
  assert.equal(await page.evaluate(() => window.qaRace.player2.finishPosition), 1);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true,
    args: ['--use-angle=d3d11', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const errors = [];
    for (const check of [live, fixture]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await check(page);
      await page.close();
    }
    assert.deepEqual(errors, []);
    console.log('Local two-driver controls, camera switching, Slipstream cues, reduced motion, restart, trial isolation and finish order passed.');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
