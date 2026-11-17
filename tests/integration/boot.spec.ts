// Playwright: the single-file build opened from disk, driven through the
// game-state hook (src/hook.ts). npm run smoke runs only the @boot test.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const config = JSON.parse(readFileSync('data/config.json', 'utf8'));
const build = (query: string): string => `${pathToFileURL(resolve('dist-single/index.html')).href}?${query}`;

/** Opens the build and collects every page error and console error. */
async function open(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(build(query));
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  return errors;
}

test('boots to the title screen with no errors @boot', async ({ page }) => {
  const errors = await open(page, 'manual=1&render=cheap');
  expect(await page.evaluate(() => window.game!.scene)).toBe('title');
  const size = await page.locator('#game').boundingBox();
  expect(size && size.width > 0 && size.height > 0).toBe(true);
  expect(errors).toEqual([]);
});

test('the countdown runs out, the player runs forward, and the same seed repeats it exactly', async ({ page }) => {
  // ?manual=1 stops the loop, so only step() moves the game.
  const countdownSteps = Math.ceil(config.countdown.value * 60) + 1;
  async function run(): Promise<{ scene: string; phase: string; moved: number; bots: number[][] }> {
    await open(page, 'manual=1&render=cheap&seed=7');
    return page.evaluate((n) => {
      const g = window.game!;
      type S = { phase: string; player: { x: number; z: number }; bots: { x: number; z: number }[] };
      const s = () => g.state as S;
      g.press('Enter'); g.step(1, false);
      g.step(n, false);
      const x0 = s().player.x;
      g.hold('KeyW', true); g.step(30, false); g.hold('KeyW', false);
      return {
        scene: g.scene, phase: s().phase, moved: x0 - s().player.x,
        bots: s().bots.map(b => [b.x, b.z]),
      };
    }, countdownSteps);
  }
  const first = await run();
  expect(first.scene).toBe('play');
  expect(first.phase).toBe('fight');
  // the first spawn faces -x toward a cover wall about 5 m off; half a second of running
  // covers most of half a second at walking speed and stops short of it
  expect(first.moved).toBeGreaterThan(config.walkSpeed.value * 0.5 * 0.7);
  expect(first.moved).toBeLessThan(config.walkSpeed.value * 0.5 + 1e-6);
  expect(await run()).toEqual(first);
});
