const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PORTFOLIO_TEST_DRIVER || 'playwright-core');

const url = (process.env.PORTFOLIO_TEST_URL || 'http://127.0.0.1:8317') + '/jeep-racing/';
const output = process.env.PORTFOLIO_TEST_OUTPUT;
const wait = { timeout: 45000 };
const readouts = { breakaway: 'Bumper off', arcade: 'Heavy impact' };

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    errors.push(`${message.text()} (${message.location().url})`);
  });
  return errors;
}

async function impactReadout(page, text) {
  await page.waitForFunction(label => {
    const readout = document.querySelector('#impact-readout');
    return !readout.hidden && readout.textContent === label;
  }, text, wait);
}

async function checkMode(scope, active) {
  for (const mode of Object.keys(readouts)) {
    assert.equal(await scope.locator(`[data-mode=${mode}]`).getAttribute('aria-pressed'), String(mode === active));
  }
}

async function open(page, name = 'Test a collision') {
  await page.getByRole('button', { name }).click();
  await page.locator('#hud').waitFor({ state: 'visible', ...wait });
}

async function pause(page) {
  await page.locator('#hud').getByRole('button', { name: 'Pause race' }).click();
  const panel = page.getByRole('dialog', { name: 'Paused' });
  await panel.waitFor({ state: 'visible', ...wait });
  return panel;
}

async function listen(page) {
  // Tap the production master without routing or modifying the game module.
  await page.addInitScript(() => {
    const connect = AudioNode.prototype.connect;
    const qa = window.impactQA = { audio: null, recording: null };
    AudioNode.prototype.connect = function (destination, ...args) {
      if (destination === this.context.destination && !qa.audio) {
        const analyser = this.context.createAnalyser();
        const mix = this.context.createMediaStreamDestination();
        const samples = new Float32Array(analyser.fftSize);
        connect.call(this, analyser);
        connect.call(analyser, mix);
        qa.audio = { analyser, mix, samples };
      }
      return connect.call(this, destination, ...args);
    };

    qa.rms = () => {
      if (!qa.audio || qa.audio.analyser.context.state !== 'running') return 0;
      const { analyser, samples } = qa.audio;
      analyser.getFloatTimeDomainData(samples);
      return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    };

    qa.arm = label => {
      const readout = document.querySelector('#impact-readout');
      const chunks = [];
      let recorder;
      let startedAt;
      let impactAt;
      let peakRms = 0;
      let impactRms = 0;
      let metering;
      qa.recording = null;
      const observe = new MutationObserver(() => {
        if (!recorder && readout.textContent === 'Stay straight to test the hit.') {
          recorder = new MediaRecorder(qa.audio.mix.stream, { mimeType: 'audio/webm;codecs=opus' });
          recorder.ondataavailable = ({ data }) => chunks.push(data);
          recorder.onstop = async () => {
            clearInterval(metering);
            qa.recording = {
              startedAt: performance.timeOrigin + startedAt,
              impactAt: performance.timeOrigin + impactAt,
              peakRms,
              impactRms,
            };
            const reader = new FileReader();
            reader.onload = () => { qa.recording.audio = String(reader.result).split(',')[1]; };
            reader.readAsDataURL(new Blob(chunks, { type: recorder.mimeType }));
          };
          recorder.start(160);
          startedAt = performance.now();
          metering = setInterval(() => {
            const level = qa.rms();
            peakRms = Math.max(peakRms, level);
            if (impactAt && performance.now() - impactAt < 550) impactRms = Math.max(impactRms, level);
          }, 25);
        }
        if (recorder && !impactAt && readout.textContent === label) {
          impactAt = performance.now();
          observe.disconnect();
          setTimeout(() => recorder.stop(), 2100);
        }
      });
      observe.observe(readout, { childList: true, characterData: true, subtree: true });
    };
  });
}

function encodeVideo(args, input) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { input, encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
}

async function videoFromFrames(mode, frames, report, audio) {
  const rate = 30;
  const live = frames.filter(({ at }) => at >= report.startedAt && at <= report.impactAt + 2000);
  assert.ok(live.length >= 12, `Browser compositor produced ${live.length} frames for ${mode}`);
  const start = Math.max(live[0].at, report.impactAt - 850);
  const end = Math.min(live.at(-1).at, report.impactAt + 1850);
  assert.ok(end - start > 1900, `Visible lead-up and aftermath for ${mode}`);
  const timeline = [];
  let cursor = 0;
  for (let at = start; at <= end; at += 1000 / rate) {
    while (cursor + 1 < live.length && live[cursor + 1].at <= at) cursor += 1;
    timeline.push(live[cursor].image);
  }
  const sound = path.join(output, `Collision ${mode} audio scratch.webm`);
  const audioBytes = Buffer.from(audio, 'base64');
  assert.ok(audioBytes.length > 1000, `Audible track recorded for ${mode}`);
  await fs.writeFile(sound, audioBytes);
  try {
    encodeVideo([
      '-f', 'image2pipe', '-framerate', String(rate), '-i', 'pipe:0',
      '-ss', ((start - report.startedAt) / 1000).toFixed(3), '-i', sound,
      '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-t', (timeline.length / rate).toFixed(3), '-movflags', '+faststart',
      path.join(output, `Collision ${mode}.mp4`),
    ], Buffer.concat(timeline));
  } finally {
    await fs.rm(sound);
  }
  return { impactInVideoSeconds: (report.impactAt - start) / 1000, compositorFrames: live.length, videoFrames: timeline.length };
}

function createComparison({ breakaway, arcade }) {
  const lead = Math.min(breakaway.impactInVideoSeconds, arcade.impactInVideoSeconds);
  const font = process.platform === 'win32' ? "fontfile='C\\:/Windows/Fonts/segoeuib.ttf':" : '';
  const holdStart = lead + 0.2;
  const holdEnd = lead + 0.25;
  const layout = ['Breakaway', 'Arcade'].map((label, i) =>
    `[${i}:v]pad=iw:ih+46:0:46:color=0x172431,` +
    `drawtext=${font}text=${label}:fontcolor=0xfff1d5:fontsize=25:x=(w-tw)/2:y=8[v${i}]`);
  const filters = [
    ...layout, '[v0][v1]hstack=shortest=1,split[play][replay]',
    `[replay]trim=start=${holdStart.toFixed(3)}:end=${holdEnd.toFixed(3)},setpts=PTS-STARTPTS,` +
      'tpad=stop_mode=clone:stop_duration=1.15,' +
      `drawtext=${font}text=Impact replay:fontcolor=0xffdb85:fontsize=20:x=(w-tw)/2:y=11[hold]`,
    '[play][hold]concat=n=2:v=1:a=0[v]',
    '[0:a]pan=stereo|c0=c0|c1=0*c0[a0]', '[1:a]pan=stereo|c0=0*c0|c1=c0[a1]',
    '[a0][a1]amix=inputs=2:duration=shortest:normalize=0,apad=pad_dur=1.25[a]',
  ];
  encodeVideo([
    '-ss', (breakaway.impactInVideoSeconds - lead).toFixed(3), '-i', path.join(output, 'Collision breakaway.mp4'),
    '-ss', (arcade.impactInVideoSeconds - lead).toFixed(3), '-i', path.join(output, 'Collision arcade.mp4'),
    '-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k',
    '-shortest', '-movflags', '+faststart', path.join(output, 'Collision modes comparison.mp4'),
  ]);
}

async function recordImpact(page, mode, action) {
  const label = readouts[mode];
  if (!output) {
    await action();
    await impactReadout(page, label);
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ at: metadata.timestamp * 1000, image: Buffer.from(data, 'base64') });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
  try {
    await page.evaluate(label => window.impactQA.arm(label), label);
    await action();
    await impactReadout(page, label);
    await page.waitForTimeout(155);
    await page.screenshot({ path: path.join(output, `Collision ${mode} impact.png`) });
    await page.waitForFunction(() => window.impactQA.recording?.audio, null, wait);
    const { audio, ...report } = await page.evaluate(() => window.impactQA.recording);
    const impactSeconds = (report.impactAt - report.startedAt) / 1000;
    assert.ok(impactSeconds > 0.3, 'Capture the approach to impact');
    assert.ok(report.peakRms > 0.004 && report.impactRms > 0.004, `Audible race output for ${mode}`);
    const video = await videoFromFrames(mode, frames, report, audio);
    return { impactSeconds, peakRms: report.peakRms, impactRms: report.impactRms, ...video };
  } finally {
    await cdp.send('Page.stopScreencast');
    await cdp.detach();
  }
}

async function gridState(page) {
  return page.evaluate(() => ({
    position: document.querySelector('#position').textContent,
    speed: document.querySelector('#speed').textContent,
    lap: document.querySelector('#lap').textContent,
    lights: document.querySelector('#start-lights').dataset.lit,
    cars: Array.from(document.querySelectorAll('#minimap circle'), marker => [marker.getAttribute('cx'), marker.getAttribute('cy')]),
  }));
}

async function desktop(browser) {
  const page = await browser.newPage({ viewport: { width: 920, height: 520 } });
  const errors = watchErrors(page);
  await listen(page);
  await page.goto(url);
  const hud = page.locator('#hud');
  const restart = hud.locator('[data-restart]');
  const sound = hud.getByRole('button', { name: 'Race sound' });

  await open(page);
  await checkMode(hud, 'breakaway');
  await impactReadout(page, readouts.breakaway);
  await page.waitForFunction(() => window.impactQA.rms() > 0.004, null, wait);

  const breakaway = await recordImpact(page, 'breakaway', () => restart.click());
  const arcade = await recordImpact(page, 'arcade', async () => {
    await restart.click();
    await hud.locator('[data-mode=arcade]').click();
    await checkMode(hud, 'arcade');
  });

  let dialog = await pause(page);
  await checkMode(dialog, 'arcade');
  await dialog.locator('[data-mode=breakaway]').click();
  await checkMode(dialog, 'breakaway');
  await dialog.locator('[data-restart]').click();
  await dialog.waitFor({ state: 'hidden' });
  await checkMode(hud, 'breakaway');
  await impactReadout(page, readouts.breakaway);

  await sound.click();
  assert.equal(await sound.getAttribute('aria-pressed'), 'false');
  await page.waitForFunction(() => window.impactQA.audio?.analyser.context.state === 'suspended', null, wait);
  await sound.click();
  assert.equal(await sound.getAttribute('aria-pressed'), 'true');
  await page.waitForFunction(() => window.impactQA.rms() > 0.004, null, wait);

  dialog = await pause(page);
  await dialog.locator('[data-mode=arcade]').click();
  await checkMode(dialog, 'arcade');
  await page.reload();
  await open(page);
  await checkMode(hud, 'arcade');
  await impactReadout(page, readouts.arcade);
  dialog = await pause(page);
  await dialog.getByRole('button', { name: 'Back to project' }).click();

  await open(page, 'Race the Jeeps');
  const originalGrid = await gridState(page);
  assert.equal(originalGrid.speed, '0');
  assert.equal(originalGrid.lap, '1');
  assert.equal(originalGrid.lights, '1');
  await page.waitForFunction(() => Number(document.querySelector('#start-lights').dataset.lit) > 1, null, wait);
  await restart.click();
  assert.deepEqual(await gridState(page), originalGrid, 'Live restart resets the countdown and keeps the normal grid');
  await page.waitForFunction(() => Number(document.querySelector('#start-lights').dataset.lit) > 1, null, wait);
  dialog = await pause(page);
  await dialog.locator('[data-restart]').click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(await gridState(page), originalGrid, 'Paused restart also returns to the same normal grid');
  assert.deepEqual(errors, []);
  await page.close();
  return { breakaway, arcade, originalGrid, errors };
}

async function touchTargets(scope) {
  const selectors = ['[data-mode=breakaway]', '[data-mode=arcade]', '[data-restart]'];
  const sizes = {};
  for (const selector of selectors) {
    const target = await scope.locator(selector).evaluate(button => {
      const { x, y, width, height } = button.getBoundingClientRect();
      const hit = document.elementFromPoint(x + width / 2, y + height / 2);
      return { x, y, width, height, clickable: button.contains(hit), inBounds: x >= 0 && x + width <= innerWidth && y >= 0 && y + height <= innerHeight };
    });
    assert.ok(target.width >= 44 && target.height >= 44 && target.clickable && target.inBounds,
      `Usable 44 px touch target at 320 px: ${selector} ${JSON.stringify(target)}`);
    sizes[selector] = target;
  }
  return sizes;
}

async function mobile(browser) {
  const page = await browser.newPage({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true });
  const errors = watchErrors(page);
  await page.goto(url);
  await page.getByRole('button', { name: 'Test a collision' }).tap();
  const hud = page.locator('#hud');
  await hud.waitFor({ state: 'visible', ...wait });
  assert.ok(await page.evaluate(() => innerWidth === 320 && document.body.scrollWidth <= innerWidth));
  const playing = await touchTargets(hud);
  await hud.locator('[data-mode=arcade]').tap();
  await checkMode(hud, 'arcade');
  await hud.locator('[data-restart]').tap();
  await impactReadout(page, readouts.arcade);
  const dialog = await pause(page);
  const paused = await touchTargets(dialog);
  await dialog.locator('[data-mode=breakaway]').tap();
  await dialog.locator('[data-restart]').tap();
  await dialog.waitFor({ state: 'hidden' });
  await impactReadout(page, readouts.breakaway);
  if (output) await page.screenshot({ path: path.join(output, 'Collision controls 320.png') });
  assert.deepEqual(errors, []);
  await page.close();
  return { playing, paused, errors };
}

async function run() {
  if (output) await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true,
    args: process.env.PORTFOLIO_FORCE_SOFTWARE === '1' ?
      ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] :
      ['--enable-unsafe-swiftshader', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
  });
  try {
    const results = { desktop: await desktop(browser), touch320: await mobile(browser) };
    if (output) {
      createComparison(results.desktop);
      await fs.writeFile(path.join(output, 'Collision browser QA.json'), JSON.stringify(results, null, 2));
    }
    console.log('Both impact modes, live switch, save/reload, live and paused restart, audible output, and 320 px touch passed.');
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
