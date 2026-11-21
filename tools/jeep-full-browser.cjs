const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { build } = require('esbuild');
const { chromium } = require(process.env.PORTFOLIO_TEST_DRIVER || 'playwright-core');

const url = (process.env.PORTFOLIO_TEST_URL || 'http://127.0.0.1:8317') + '/jeep-racing/';
const output = process.env.PORTFOLIO_TEST_OUTPUT || require('node:os').tmpdir();
const entry = path.resolve(__dirname, '../src/jeep-racing.js');

async function instrumentedEntry() {
  const script = (await fs.readFile(entry, 'utf8')).replace(/\r\n/g, '\n');
  const hook = "  updateHUD();\n  if (game.phase === 'finished')";
  assert.ok(script.includes(hook), 'Expected the frame-end HUD update');
  const instrumentation =
    "import { makeDriver } from '../tools/jeep-browser-driver.mjs';\n" +
    "let observedRace, driver, observedKeys = new Set();\n" +
    "function observeFrame(race, dt) {\n" +
    "  if (observedRace !== race) {\n" +
    "    observedRace = race;\n" +
    "    driver = makeDriver(track, " + process.argv.includes('--film-descent') + ");\n" +
    "    observedKeys.clear();\n" +
    "    window.raceQA = { raceEvents: [], peakRms: 0, peakWake: 0, bestPosition: 4, overtakes: [], lights: [], frameCount: 0, events: driver.events };\n" +
    "  }\n" +
    "  const qa = window.raceQA;\n" +
    "  for (const event of race.events) qa.raceEvents.push({...event, progress: race.player.s});\n" +
    "  if (window.qaTap && qa.frameCount % 8 === 0) {\n" +
    "    const { analyser, samples } = window.qaTap; analyser.getFloatTimeDomainData(samples);\n" +
    "    qa.peakRms = Math.max(qa.peakRms, Math.sqrt(samples.reduce((sum, v) => sum + v*v, 0)/samples.length));\n" +
    "  }\n" +
    "  const position = race.standings().indexOf(race.player) + 1;\n" +
    "  if (position < qa.bestPosition) {\n" +
    "    if (qa.frameCount > 0) qa.overtakes.push({ from: qa.bestPosition, to: position, at: race.elapsed, progress: race.player.s });\n" +
    "    qa.bestPosition = position;\n" +
    "  }\n" +
    "  if (race.startLights && !qa.lights.includes(race.startLights)) qa.lights.push(race.startLights);\n" +
    "  qa.frameCount += 1;\n" +
    "  qa.peakWake = Math.max(race.player.wake, qa.peakWake);\n" +
    "  Object.assign(qa, { elapsed: race.elapsed, phase: race.phase, position, s: race.player.s, lap: race.player.lap,\n" +
    "    completedLaps: race.player.completedLaps, bestLap: race.player.bestLap, lastLap: race.player.lastLap,\n" +
    "    finishTime: race.player.finishTime, finishPosition: race.player.finishPosition, wake: race.player.wake,\n" +
    "    speed: race.player.speed, offset: race.player.offset, boost: race.player.boostTime });\n" +
    "  qa.field = race.cars.map(({id, bestLap, finishTime, finishPosition}) => ({id, bestLap, finishTime, finishPosition}));\n" +
    "  if (Math.floor(race.elapsed / 5) !== qa.split) {\n" +
    "    qa.split = Math.floor(race.elapsed / 5);\n" +
    "    console.log('race-qa ' + JSON.stringify({ elapsed: qa.elapsed, s: qa.s, wake: qa.wake, source: race.player.towRivalId }));\n" +
    "  }\n" +
    "  if (!window.raceQAInput || race.phase === 'finished') return;\n" +
    "  const input = driver.input(race, dt);\n" +
    "  const next = new Set([input.throttle && 'ArrowUp', input.brake && 'ArrowDown',\n" +
    "    input.steer < 0 && 'ArrowLeft', input.steer > 0 && 'ArrowRight'].filter(Boolean));\n" +
    "  const dispatch = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code === 'Space' ? ' ' : code, bubbles: true, cancelable: true }));\n" +
    "  for (const key of observedKeys) if (!next.has(key)) dispatch('keyup', key);\n" +
    "  for (const key of next) if (!observedKeys.has(key)) dispatch('keydown', key);\n" +
    "  if (input.boost) { dispatch('keydown', 'Space'); dispatch('keyup', 'Space'); }\n" +
    "  observedKeys = next;\n" +
    "}\n";
  const source = instrumentation + script.replace(hook, "  updateHUD();\n  observeFrame(game, dt);\n  if (game.phase === 'finished')");
  const bundle = await build({
    stdin: { contents: source, resolveDir: path.dirname(entry), sourcefile: entry },
    bundle: true, write: false, format: 'esm', minify: true,
  });
  return bundle.outputFiles[0].text;
}

async function run() {
  const body = await instrumentedEntry();
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN, headless: true,
    args: process.env.PORTFOLIO_FORCE_SOFTWARE === '1' ?
      ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] :
      ['--enable-unsafe-swiftshader', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
  });
  try {
    await fs.mkdir(output, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 650 } });
    const cdp = await browser.newBrowserCDPSession();
    const { gpu } = await cdp.send('SystemInfo.getInfo');
    console.log('GPU', JSON.stringify({ renderer: gpu.auxAttributes?.glRenderer, devices: gpu.devices }));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', (message) => {
      if (message.text().startsWith('race-qa ')) console.log(message.text());
    });
    await page.route('**/jeep-racing.js', route => route.fulfill({contentType: 'text/javascript', body}));
    await page.addInitScript(() => {
      window.raceQAInput = true;
      const connect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (destination, ...args) {
        if (destination === this.context.destination && !window.qaTap) {
          const analyser = this.context.createAnalyser();
          connect.call(this, analyser);
          window.qaTap = { analyser, samples: new Float32Array(analyser.fftSize) };
        }
        return connect.call(this, destination, ...args);
      };
    });
    await page.goto(url);
    await page.getByRole('button', { name: 'Race the Jeeps' }).click();
    await page.waitForFunction(() => window.raceQA?.phase === 'countdown', null, { timeout: 60000 });
    console.log('Countdown began.');
    const capture = (name) => page.screenshot({ path: path.join(output, name + '.png'), timeout: 20000 });
    const get = () => page.evaluate(() => ({
      ...window.raceQA, bars: document.querySelector('#wake').dataset.strength,
      supplyingRival: document.querySelector('#wake-rival').textContent,
      boostLabel: document.querySelector('#boost-state').textContent,
    }));
    await capture('browser-full-race-grid');
    await page.waitForFunction(() => window.raceQA.raceEvents.some(e => e.type === 'raceStart'), null, { timeout: 45000 });
    await capture('browser-full-race-start');
    const { track } = await import('../src/jeep/track.js');
    const turnAt = name => track.turns.find(turn => turn.name === name).s;
    const descentStart = turnAt('La Source');
    const valley = turnAt('Eau Rouge');
    const recordDescent = process.argv.includes('--film-descent');
    if (recordDescent) {
      await page.waitForFunction(s => window.raceQA.s >= s, descentStart - 4);
      await page.evaluate(() => {
        const stream = document.querySelector('#race-canvas').captureStream(30);
        const { analyser } = window.qaTap;
        const mix = analyser.context.createMediaStreamDestination();
        analyser.connect(mix);
        stream.addTrack(mix.stream.getAudioTracks()[0]);
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: 3500000 });
        const chunks = [];
        recorder.ondataavailable = ({ data }) => chunks.push(data);
        window.endDescentClip = () => new Promise(resolve => {
          recorder.onstop = async () => {
            analyser.disconnect(mix);
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.readAsDataURL(new Blob(chunks));
            for (const track of stream.getTracks()) track.stop();
          };
          recorder.stop();
        });
        recorder.start();
      });
    }
    for (const [name, distance] of [
      ['descent', descentStart + .35 * (valley - descentStart)],
      ['eau-rouge', valley - 14],
      ['raidillon', turnAt('Raidillon')],
      ['pouhon', turnAt('Pouhon') - 20],
    ]) {
      await page.waitForFunction(s => window.raceQA.s >= s, distance, {timeout: 100000});
      await capture('browser-full-race-' + name);
      if (recordDescent && name === 'raidillon') {
        await page.waitForFunction(s => window.raceQA.s >= s, turnAt('Kemmel Straight') + 2);
        const video = await page.evaluate(() => window.endDescentClip());
        await fs.writeFile(path.join(output, 'Eau Rouge chase.webm'), Buffer.from(video, 'base64'));
        assert.deepEqual(errors, []);
        console.log('Saved descent and climb with race audio.');
        return;
      }
    }
    await page.waitForFunction(() => window.raceQA?.completedLaps === 1, null, { timeout: 360000 });
    console.log('Lap two began.');
    await page.waitForFunction(() => document.querySelector('#countdown').classList.contains('finish-banner'), null, { timeout: 360000 });
    await capture('browser-full-race-flag');
    await page.getByRole('heading', { name: 'Race complete' }).waitFor({ timeout: 30000 });
    const results = await get();
    assert.equal(results.completedLaps, 2);
    // Use average lap speed so a shorter layout can legitimately have sub-minute laps.
    for (const seconds of [results.bestLap, results.lastLap]) {
      const metresPerSecond = track.length / seconds;
      assert.ok(metresPerSecond > 14 && metresPerSecond < 39, 'Plausible lap speed on this course');
    }
    for (const rival of results.field.filter(car => car.id !== 'player')) {
      assert.ok(Number.isFinite(rival.bestLap) && rival.bestLap > 0, 'Rival recorded a legal lap');
    }
    assert.ok(results.finishPosition >= 1 && results.finishPosition <= 4);
    assert.ok(results.peakWake > .4, 'Driver encountered a usable tow');
    assert.ok(results.peakRms > .004, 'Master output contained audible samples');
    assert.equal(results.raceEvents.filter(e => e.type === 'raceStart').length, 1);
    const finishes = results.raceEvents.filter(e => e.type === 'playerFinish');
    assert.equal(finishes.length, 1);
    assert.equal(finishes[0].position, results.finishPosition);
    assert.equal(await page.locator('#finish-place').textContent(), results.finishPosition + ' / 4');
    assert.match(await page.locator('#finish-time').textContent(), /^\d+:\d\d\.\d{3}$/);
    assert.match(await page.locator('#best-lap').textContent(), /^\d+:\d\d\.\d{3}$/);
    assert.deepEqual(results.lights, [1, 2, 3, 4, 5]);
    assert.deepEqual(errors, []);
    await capture('browser-full-race-results');
    await page.evaluate(() => { window.raceQAInput = false; });
    await page.getByRole('button', { name: 'Race again' }).press('Enter');
    const lights = page.locator('#start-lights');
    assert.ok(await lights.isVisible());
    assert.equal(await page.locator('#lap').textContent(), '1');
    assert.equal(await page.locator('#speed').textContent(), '0');
    await capture('browser-full-race-replay');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Back to project' }).click();
    await page.getByRole('button', { name: 'Race the Jeeps' }).waitFor();
    await fs.writeFile(path.join(output, 'browser-full-race.json'), JSON.stringify({ results }, null, 2));
    console.log('Results and replay', JSON.stringify(results));
  } finally {
    await browser.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
