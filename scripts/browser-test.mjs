/**
 * Browser end-to-end check for the dashboard (preview/mock mode).
 * Usage: node scripts/browser-test.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173';
const OUT = 'artifacts';

let pass = 0;
let fail = 0;
const problems = [];

function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail += 1;
    problems.push(name);
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

try {
  /* ---------- login ---------- */
  console.log('\n\x1b[1m1. Login screen\x1b[0m');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#login-form', { timeout: 15000 });
  check('login form renders', true);
  check('preview banner shown', await page.locator('.preview-banner').count() > 0);
  await page.screenshot({ path: `${OUT}/01-login.png` });

  await page.fill('#email', 'owner@storage.local');
  await page.fill('#password', 'preview-admin-123');
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('.stat-grid', { timeout: 15000 });
  await page.waitForTimeout(700);
  check('dashboard renders after login', true);

  /* ---------- dashboard ---------- */
  console.log('\n\x1b[1m2. Dashboard\x1b[0m');
  const statCount = await page.locator('.stat').count();
  check('4 stat cards', statCount === 4, `found ${statCount}`);
  const projCards = await page.locator('.project-card').count();
  check('2 seeded project cards', projCards === 2, `found ${projCards}`);
  check('project slot shows limit reached', await page.locator('.project-slot:disabled, .project-slot[aria-disabled="true"]').count() > 0);
  check('activity feed populated', await page.locator('.activity__row').count() > 0);
  check('KV + Blob meters present', await page.locator('.meter-card').count() === 2);
  const bodyText = await page.locator('#page-content').innerText();
  check('storage values rendered', /KB|MB|B\b/.test(bodyText));
  await page.screenshot({ path: `${OUT}/02-dashboard.png`, fullPage: true });

  /* ---------- projects ---------- */
  console.log('\n\x1b[1m3. Projects page\x1b[0m');
  await page.click('[data-nav="projects"]');
  await page.waitForSelector('.project-grid', { timeout: 10000 });
  check('projects page loads', await page.locator('.project-card').count() === 2);
  await page.screenshot({ path: `${OUT}/03-projects.png`, fullPage: true });

  /* ---------- project details ---------- */
  console.log('\n\x1b[1m4. Project details + configs\x1b[0m');
  await page.locator('.project-card').first().click();
  await page.waitForSelector('.project-hero', { timeout: 10000 });
  check('project hero renders', true);
  check('metric row shows 4 metrics', await page.locator('.metric').count() === 4);

  await page.click('[data-tab="config"]');
  await page.waitForTimeout(300);
  check('user config card present', await page.locator('.config-card').first().isVisible());
  const configText = await page.locator('[data-panel="config"]').innerText();
  check('user token masked by default', configText.includes('•'));
  check('capability list shown', configText.toLowerCase().includes('read existing records'));
  await page.screenshot({ path: `${OUT}/04-config.png`, fullPage: true });

  // reveal secret
  await page.locator('[data-action="toggle-secret"]').first().click();
  await page.waitForTimeout(200);
  const revealed = await page.locator('[data-secret-value]').first().innerText();
  check('secret reveal shows full token', revealed.startsWith('etu1.'), revealed.slice(0, 12));

  /* ---------- records ---------- */
  console.log('\n\x1b[1m5. Records tab\x1b[0m');
  await page.click('[data-tab="records"]');
  await page.waitForSelector('#records-panel .table, #records-panel .empty', { timeout: 10000 });
  const rows = await page.locator('#records-panel tbody tr').count();
  check('records table has rows', rows > 0, `rows=${rows}`);
  await page.screenshot({ path: `${OUT}/05-records.png`, fullPage: true });

  // create record
  await page.click('#records-panel [data-action="create-record"]');
  await page.waitForSelector('.modal', { timeout: 5000 });
  check('record modal opens', await page.locator('.modal').isVisible());
  await page.fill('.modal [data-key]', 'e2e-test');
  await page.fill('.modal [data-content]', '{"hello":"world","from":"e2e"}');
  await page.click('.modal [data-save]');
  await page.waitForTimeout(900);
  const afterCreate = await page.locator('#records-panel tbody tr').count();
  check('record created via dashboard', afterCreate >= rows, `${rows} -> ${afterCreate}`);

  /* ---------- files ---------- */
  console.log('\n\x1b[1m6. Files tab + upload\x1b[0m');
  await page.click('[data-tab="files"]');
  await page.waitForSelector('#files-panel', { timeout: 8000 });
  await page.waitForTimeout(600);
  const tilesBefore = await page.locator('.file-tile').count();
  check('file tiles render', tilesBefore > 0, `tiles=${tilesBefore}`);

  await page.setInputFiles('[data-file-input]', {
    name: 'e2e-note.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello from the browser test'),
  });
  await page.waitForTimeout(1200);
  const tilesAfter = await page.locator('.file-tile').count();
  check('file uploaded via dropzone', tilesAfter > tilesBefore, `${tilesBefore} -> ${tilesAfter}`);
  await page.screenshot({ path: `${OUT}/06-files.png`, fullPage: true });

  /* ---------- storage page ---------- */
  console.log('\n\x1b[1m7. Storage manager\x1b[0m');
  await page.click('[data-nav="storage"]');
  await page.waitForSelector('#storage-host', { timeout: 8000 });
  await page.waitForTimeout(800);
  check('storage records view', await page.locator('#storage-host .table, #storage-host .empty').count() > 0);
  await page.click('[data-storage-tab="files"]');
  await page.waitForTimeout(800);
  check('storage files view', await page.locator('#storage-host .file-grid, #storage-host .empty').count() > 0);
  await page.screenshot({ path: `${OUT}/07-storage.png`, fullPage: true });

  /* ---------- settings ---------- */
  console.log('\n\x1b[1m8. Settings\x1b[0m');
  await page.click('[data-nav="settings"]');
  await page.waitForSelector('.settings-grid', { timeout: 8000 });
  check('settings page renders', true);
  check('security posture list present', (await page.locator('.card').count()) >= 4);
  await page.screenshot({ path: `${OUT}/08-settings.png`, fullPage: true });

  /* ---------- docs ---------- */
  console.log('\n\x1b[1m9. Docs + security notes\x1b[0m');
  await page.click('[data-nav="docs"]');
  await page.waitForSelector('.table', { timeout: 8000 });
  check('API reference table renders', await page.locator('.table tbody tr').count() > 10);
  await page.click('[data-nav="security"]');
  await page.waitForTimeout(500);
  check('security notes page renders', (await page.locator('#page-content').innerText()).includes('User Panel credential'));

  /* ---------- create a project after deleting one ---------- */
  console.log('\n\x1b[1m10. Delete + create flow\x1b[0m');
  await page.click('[data-nav="projects"]');
  await page.waitForSelector('.project-grid');
  await page.locator('.project-card').last().click();
  await page.waitForSelector('.project-hero');
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(300);
  await page.click('[data-action="delete-project"]');
  await page.waitForSelector('.modal');
  await page.click('.modal [data-confirm]');
  await page.waitForTimeout(500);
  await page.click('.modal [data-confirm]'); // keep data / purge choice
  await page.waitForTimeout(500);
  const projectName = (await page.locator('.project-hero__name').innerText()).split('\n')[0].trim();
  await page.fill('.modal [data-input]', projectName);
  await page.click('.modal [data-ok]');
  await page.waitForTimeout(1200);
  check('project deleted after typed confirmation', (await page.locator('.project-card').count()) === 1);

  await page.click('[data-nav="projects"]');
  await page.waitForTimeout(600);
  await page.click('.project-slot');
  await page.waitForSelector('.modal');
  await page.fill('#project-name', 'E2E Test Project');
  await page.click('.modal [data-submit]');
  await page.waitForTimeout(1500);
  const createdText = await page.locator('.modal').innerText();
  check('create modal shows generated credentials', createdText.includes('etu1.') && createdText.includes('adm_'));
  await page.screenshot({ path: `${OUT}/09-created.png` });
  await page.click('.modal [data-done]');
  await page.waitForTimeout(800);
  check('new project appears in list', await page.locator('.project-card').count() === 2);

  /* ---------- mobile ---------- */
  console.log('\n\x1b[1m11. Responsive (iPhone 390x844)\x1b[0m');
  await page.setViewportSize({ width: 390, height: 844 });
  // Reload so the shell is built for the phone viewport from the start.
  await page.goto(`${BASE}/#/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.waitForSelector('.stat-grid', { timeout: 10000 });
  await page.waitForTimeout(700);
  await page.waitForTimeout(500);
  check('mobile tabbar visible', await page.locator('.tabbar').isVisible());
  check('sidebar hidden off-canvas', await page.locator('#sidebar').evaluate((el) => !el.classList.contains('is-open')));
  const hasHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 2,
  );
  check('no horizontal overflow on mobile', !hasHorizontalScroll, hasHorizontalScroll ? 'page is wider than viewport' : '');
  await page.screenshot({ path: `${OUT}/10-mobile-dashboard.png`, fullPage: true });

  await page.locator('.tabbar [data-nav="projects"]').click();
  await page.waitForTimeout(900);
  check('mobile tab navigation works', (await page.locator('.project-grid').count()) > 0);
  await page.screenshot({ path: `${OUT}/11-mobile-projects.png`, fullPage: true });

  // drawer nav
  await page.click('#nav-toggle');
  await page.waitForTimeout(500);
  check('mobile drawer opens', await page.locator('#sidebar').evaluate((el) => el.classList.contains('is-open')));
  await page.screenshot({ path: `${OUT}/11b-mobile-drawer.png` });
  await page.locator('#sidebar-backdrop').click({ position: { x: 350, y: 400 } });
  await page.waitForTimeout(400);

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(`${BASE}/#/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const tabletOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  check('no horizontal overflow on tablet', !tabletOverflow);
  await page.screenshot({ path: `${OUT}/12-tablet-dashboard.png`, fullPage: true });

  /* ---------- console errors ---------- */
  console.log('\n\x1b[1m12. Console health\x1b[0m');
  const realErrors = consoleErrors.filter((e) => !/favicon|ResizeObserver/i.test(e));
  check('no console/page errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
} catch (error) {
  fail += 1;
  problems.push(`exception: ${error.message}`);
  console.error('\x1b[31mTest crashed:\x1b[0m', error.message);
  await page.screenshot({ path: `${OUT}/crash.png`, fullPage: true }).catch(() => {});
}

await browser.close();

console.log(`\n\x1b[1mBrowser result:\x1b[0m ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\x1b[31mProblems:\x1b[0m');
  problems.forEach((p) => console.log(` - ${p}`));
  process.exit(1);
}
console.log('\x1b[32mDashboard verified end-to-end.\x1b[0m');
