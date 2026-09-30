// Phase 10 verification (c) and (f): independent browser contexts create and
// join lobbies by match code against the Firebase emulator, see each other's
// names live, a fifth player is refused, and players leaving update everyone.
import { test, expect } from '@playwright/test';
import { player, create, join, sees, status } from './mp-helpers.js';

test.describe.configure({ timeout: 90_000 });

test('two players: create, join by code, each sees the other live', async ({ browser }) => {
  const a = await player(browser, 'Ava'), b = await player(browser, 'Bram');
  const code = await create(a);
  await sees(a, ['Ava']);
  await join(b, `${code.slice(0, 3).toLowerCase()}-${code.slice(3)}`); // typed loosely
  await sees(b, ['Ava', 'Bram']);
  await sees(a, ['Ava', 'Bram']); // appeared on the host's screen without a reload
  await expect(a.page.locator('#mp-players li').nth(1)).toContainText('Crimson, north-east: Bram');
  await expect(a.page.locator('#mp-players li').nth(2)).toContainText('Rose, south-east: Open — Merchant Kingdom AI (Normal)'); // an open slot shows the AI that would play it
  expect([...a.errors, ...b.errors]).toEqual([]);
  await a.context.close(); await b.context.close();
});

test('four players join one lobby; a fifth is refused', async ({ browser }) => {
  const [a, b, c, d, e] = await Promise.all(['Ava', 'Bram', 'Cora', 'Dunn', 'Esk'].map((n) => player(browser, n)));
  const code = await create(a);
  await Promise.all([b, c, d].map((p) => join(p, code))); // at once: slot races are resolved by the rules
  await expect.poll(() => a.page.locator('#mp-players').getAttribute('data-names'), { timeout: 20000 }).toMatch(/^Ava(\|(Bram|Cora|Dunn)){3}$/);
  const list = (await a.page.locator('#mp-players').getAttribute('data-names')).split('|');
  expect(new Set(list)).toEqual(new Set(['Ava', 'Bram', 'Cora', 'Dunn']));
  for (const p of [b, c, d]) await sees(p, list); // everyone sees the same four, in slot order
  await join(e, code);
  await expect(status(e)).toHaveText('That lobby is full (4 players).', { timeout: 15000 });
  await expect(e.page.locator('#mp-entry')).toBeVisible();
  for (const p of [a, b, c, d]) await sees(p, list); // nobody was displaced
  expect([a, b, c, d, e].flatMap((p) => p.errors)).toEqual([]);
  for (const p of [a, b, c, d, e]) await p.context.close();
});

test('bad codes get a clear message', async ({ browser }) => {
  const a = await player(browser, 'Ava');
  await join(a, 'ABC0EF');
  await expect(status(a)).toContainText('never contain 0');
  await join(a, 'ABCDE');
  await expect(status(a)).toHaveText('A match code has 6 characters.');
  await join(a, 'ZZZZZZ');
  await expect(status(a)).toHaveText('No lobby has that code. Check it with the host.', { timeout: 15000 });
  await a.page.locator('#mp-name').fill('');
  await a.page.locator('#mp-create').click();
  await expect(status(a)).toHaveText('Enter a name the other players will see.');
  expect(a.errors).toEqual([]);
  await a.context.close();
});

test('players leaving mid-lobby update everyone; the host leaving closes it', async ({ browser }) => {
  const [a, b, c, d] = await Promise.all(['Ava', 'Bram', 'Cora', 'Dunn'].map((n) => player(browser, n)));
  const code = await create(a);
  for (const p of [b, c, d]) { await join(p, code); await sees(p, ['Ava', 'Bram', 'Cora', 'Dunn'].slice(0, [a, b, c, d].indexOf(p) + 1)); }
  // Cora leaves with the button.
  await c.page.locator('#mp-leave').click();
  await expect(status(c)).toHaveText('You left the lobby.');
  for (const p of [a, b, d]) await sees(p, ['Ava', 'Bram', 'Dunn']);
  // Dunn's tab closes without a word: the server's disconnect handler frees the slot.
  await d.context.close();
  for (const p of [a, b]) await sees(p, ['Ava', 'Bram']);
  // The freed slot can be taken again.
  await join(c, code);
  for (const p of [a, b, c]) await sees(p, ['Ava', 'Bram', 'Cora']);
  // The host's tab closes: the lobby closes for everyone, nobody is left hanging.
  await a.context.close();
  for (const p of [b, c]) {
    await expect(status(p)).toHaveText('The host closed the lobby.', { timeout: 20000 });
    await expect(p.page.locator('#mp-entry')).toBeVisible();
  }
  // And the code is dead.
  await join(b, code);
  await expect(status(b)).toHaveText('No lobby has that code. Check it with the host.', { timeout: 15000 });
  expect([b, c].flatMap((p) => p.errors)).toEqual([]);
  await b.context.close(); await c.context.close();
});
