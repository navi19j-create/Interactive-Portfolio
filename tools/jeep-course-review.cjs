// Compare the chase camera at the same points within each named sector across builds.
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PORTFOLIO_TEST_DRIVER || 'playwright-core');

async function run() {
  const output = path.join(process.env.PORTFOLIO_TEST_OUTPUT || require('node:os').tmpdir(), process.argv[2] || 'Course');
  await fs.mkdir(output, { recursive: true });
  const entry = await fs.readFile(path.resolve(__dirname, '../dist/jeep-racing.js'), 'utf8');
  const world = entry.match(/import\("\.\/(shared\/world-[\w-]+\.js)"\)/)?.[1];
  if (!world) throw new Error('Could not locate the built race world.');
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN, headless: true, args: ['--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage({ viewport: {width: 1152, height: 648} });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/jeep-racing/__course', route => route.fulfill({
      contentType: 'text/html',
      body: `<meta charset="utf-8"><style>*{margin:0}canvas{display:block;width:100vw;height:100vh}</style>
        <canvas></canvas><script type="module">
        import {createWorld, track} from '/${world}';
        const world = createWorld(document.querySelector('canvas'));
        await world.ready;
        const cars = ['player','bot-1','bot-2','bot-3'].map((id, i) => ({
          id, speed: 23, heading: 0, steer: 0, lean: 0, lap: 1, distance: 0, wake: 0,
          finishTime: null, boostTime: 0, offset: [-.65,1.4,-1.1,2.2][i],
        }));
        const race = { cars, player: cars[0], phase: 'racing', elapsed: 18, startLights: 0 };
        window.sectorPhoto = async (first, next, fraction) => {
          const at = name => track.turns.find(turn => turn.name === name).s;
          const span = (at(next) - at(first) + track.length) % track.length;
          const s = at(first) + span * fraction;
          for (let i = 0; i < cars.length; i++) cars[i].distance = cars[i].s = s + [0,14,26,32][i];
          world.react([], race);
          world.render(race, 1/60);
          await new Promise(requestAnimationFrame);
          world.render(race, 1/60);
          return {s, elevation: track.sample(s).y};
        };
        </script>`,
    }));
    const url = process.env.PORTFOLIO_TEST_URL || 'http://127.0.0.1:8317';
    await page.goto(url + '/jeep-racing/__course');
    await page.waitForFunction(() => window.sectorPhoto !== undefined);
    const files = [];
    for (const [name, first, next, fraction] of [
      ['Descent', 'La Source', 'Eau Rouge', .35],
      ['Valley', 'La Source', 'Eau Rouge', .86],
      ['Climb', 'Eau Rouge', 'Raidillon', .58],
      ['Kemmel', 'Kemmel Straight', 'Les Combes', .58],
      ['Pouhon', 'No Name', 'Pouhon', .85],
      ['Blanchimont', 'Paul Frère', 'Blanchimont', .86],
    ]) {
      const telemetry = await page.evaluate(args => window.sectorPhoto(...args), [first, next, fraction]);
      await page.screenshot({path: path.join(output, name + '.jpg'), type: 'jpeg', quality: 90});
      files.push({name, ...telemetry});
    }
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(JSON.stringify({world, files}));
  } finally {
    await browser.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
