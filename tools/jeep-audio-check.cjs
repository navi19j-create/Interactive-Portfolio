const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require(process.env.PORTFOLIO_TEST_DRIVER || 'playwright-core');

const base = process.env.PORTFOLIO_TEST_URL || 'http://127.0.0.1:8317';
const output = process.env.PORTFOLIO_TEST_OUTPUT || require('node:os').tmpdir();

async function run() {
  const modulePath = path.resolve(__dirname, '../src/jeep/audio.js');
  const bundle = await build({
    stdin: {
      sourcefile: 'audio-fixture.js',
      resolveDir: path.dirname(modulePath),
      contents: `
        import { createRaceAudio } from './audio.js';
        const NativeAudioContext = window.AudioContext;
        const contexts = [];
        window.AudioContext = class extends NativeAudioContext {
          constructor() {
            super();
            this.capture = this.createMediaStreamDestination();
            contexts.push(this);
          }
          get destination() { return this.capture; }
        };
        const audio = createRaceAudio();
        window.qa = {
          audio,
          contextCount: () => contexts.length,
          state: () => contexts.at(-1)?.state,
        };

        function rehearsal() {
          audio.unlock();
          const context = contexts.at(-1);
          const recorder = new MediaRecorder(context.capture.stream, { mimeType: 'audio/webm;codecs=opus' });
          const chunks = [];
          const offsets = {};
          recorder.ondataavailable = ({ data }) => chunks.push(data);
          recorder.onstop = () => {
            const reader = new FileReader();
            reader.onload = () => { window.qa.recording = { audio: reader.result.split(',')[1], offsets }; };
            reader.readAsDataURL(new Blob(chunks, { type: 'audio/webm' }));
          };
          recorder.start();
          const start = context.currentTime;
          const race = {
            phase: 'countdown', startLights: 0, events: [],
            player: { id: 'player', speed: 0, wake: 0, boostTime: 0, s: -19 },
          };
          let light = 0;
          let stage = 0;
          audio.start();
          const tick = setInterval(() => {
            const now = context.currentTime - start;
            if (now > 12.8) {
              clearInterval(tick);
              recorder.stop();
              return;
            }
            race.events = [];
            const nextLight = now < 4.25 ? Math.min(5, Math.max(0, 1 + Math.floor((now - .25) / .73))) : 0;
            if (nextLight > 0 && nextLight !== light) offsets['light' + nextLight] = now;
            light = nextLight;
            race.startLights = light;
            if (now >= 4.25) {
              race.phase = 'racing';
              race.player.s = Math.max(0, (now - 4.25) * 26);
              race.player.speed = Math.min(34, (now - 4.16) * 6.6 + (now > 8.0 && now < 9.9 ? 6 : 0));
              race.player.wake = now > 6.5 && now < 8 ? .86 : 0;
              race.player.boostTime = now >= 8 && now < 10 ? 10 - now : 0;
              if (stage === 0) {
                stage = 1;
                offsets.go = now;
                race.events.push({ type: 'raceStart', time: 0 });
              }
              if (stage === 1 && now >= 6.5) {
                stage = 2;
                offsets.tow = now;
              }
              if (stage === 2 && now >= 8) {
                stage = 3;
                offsets.boost = now;
              }
              if (stage === 3 && now >= 9.15) {
                stage = 4;
                offsets.pass = now;
                race.events.push({ type: 'pass', passerId: 'player', passedId: 'bot-1' });
              }
              if (stage === 4 && now >= 10.12) {
                stage = 5;
                offsets.passed = now;
                race.events.push({ type: 'pass', passerId: 'bot-2', passedId: 'player' });
              }
              if (stage === 5 && now >= 11.3) {
                stage = 6;
                offsets.finish = now;
                race.phase = 'finished';
                race.events.push({ type: 'playerFinish', position: 1 });
              }
            }
            audio.sync(race, { throttle: now >= 4.25 && now < 11.3 });
          }, 16);
        }

        document.querySelector('button').addEventListener('click', rehearsal, { once: true });
      `,
    },
    bundle: true, write: false, format: 'esm',
  });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true });
  try {
    await fs.mkdir(output, { recursive: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/jeep-racing/__audioqa', route => route.fulfill({
      contentType: 'text/html',
      body: '<button>Start audio QA</button><script type="module" src="__audioqa.js"></script>',
    }));
    await page.route('**/jeep-racing/__audioqa.js', route => route.fulfill({
      contentType: 'text/javascript', body: bundle.outputFiles[0].text,
    }));
    await page.goto(base + '/jeep-racing/__audioqa');
    await page.waitForFunction(() => window.qa);
    assert.equal(await page.evaluate(() => window.qa.contextCount()), 0, 'No AudioContext before the user gesture');
    await page.getByRole('button', { name: 'Start audio QA' }).click();
    await page.waitForFunction(() => window.qa.state() === 'running');
    await page.waitForFunction(() => window.qa.recording, null, { timeout: 25000 });
    const recording = await page.evaluate(() => window.qa.recording);
    assert.equal(Object.keys(recording.offsets).length, 11);
    assert.ok(recording.audio.length > 60000);
    await fs.writeFile(path.join(output, 'jeep-race-audio-review.webm'), Buffer.from(recording.audio, 'base64'));
    await fs.writeFile(path.join(output, 'jeep-race-audio-cues.json'), JSON.stringify(recording.offsets, null, 2));
    await page.evaluate(() => window.qa.audio.pause());
    await page.waitForFunction(() => window.qa.state() === 'suspended');
    await page.evaluate(() => window.qa.audio.resume());
    await page.waitForFunction(() => window.qa.state() === 'running');
    await page.evaluate(() => window.qa.audio.start());
    assert.equal(await page.evaluate(() => window.qa.contextCount()), 1, 'Replay reuses one AudioContext');
    await page.evaluate(() => window.qa.audio.setMuted(true));
    await page.waitForFunction(() => window.qa.state() === 'suspended');
    await page.evaluate(() => window.qa.audio.setMuted(false));
    await page.waitForFunction(() => window.qa.state() === 'running');
    await page.evaluate(() => {
      window.qa.audio.setMuted(true);
      window.qa.audio.stop();
    });
    await page.waitForFunction(() => window.qa.state() === 'closed');
    await page.reload();
    await page.waitForFunction(() => window.qa);
    assert.equal(await page.evaluate(() => window.qa.audio.muted), true);
    assert.equal(await page.evaluate(() => window.qa.contextCount()), 0);
    assert.deepEqual(errors, []);
    console.log('Audio recording, gesture, pause/resume, replay, mute persistence and teardown passed.');
    console.log(JSON.stringify(recording.offsets));
  } finally {
    await browser.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
