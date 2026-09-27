// Browser tests for the resuscitation flows. Runs against index.html and als-standalone.html
// with all network access blocked (to prove the app works offline).
//
//   npm test            (requires Playwright: `npm i -g playwright` or a local install)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['index.html', 'als-standalone.html'];
let failures = 0, passes = 0;
const check = (cond, name, detail = '') => {
  if (cond) { passes++; }
  else { failures++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const browser = await playwright.chromium.launch();

for (const file of FILES) {
  console.log(`\n${file}`);
  const url = 'file://' + path.join(root, file);

  const fresh = async ({ width = 1280, height = 900, keepStorageFrom = null } = {}) => {
    const ctx = keepStorageFrom || await browser.newContext({ viewport: { width, height } });
    await ctx.route(/^https?:/, r => r.abort()); // offline
    const p = await ctx.newPage();
    p.errs = [];
    p.on('pageerror', e => p.errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) p.errs.push(m.text()); });
    await p.clock.install();
    await p.goto(url);
    await p.waitForTimeout(100);
    return p;
  };
  const S = (p, fn) => p.evaluate(fn);
  const log = p => S(p, () => state.log.map(e => e.message));
  const text = (p, sel) => p.locator(sel).innerText();
  const closeModal = p => p.click('#summary-modal button:has-text("Close")');
  const dialogChoose = (p, label) => p.click(`#app-dialog-buttons button:has-text("${label}")`);

  // --- Adult, non-shockable: adrenaline prompted immediately; log order correct
  let p = await fresh();
  check((await text(p, '#protocol-badge')).toUpperCase() === 'ADULT ALS', 'badge shows protocol on load');
  await p.click('#start-arrest-btn');
  await p.click('#rhythm-pea-btn');
  let l = await log(p);
  check(l[0].includes('resuscitation started') && l[1].startsWith('Rhythm: PEA') && l[2].startsWith('CPR cycle 1'), 'log is chronological within the same second', JSON.stringify(l));
  check((await text(p, '#guidance-content')).includes('Give adrenaline 1 mg'), 'non-shockable: adrenaline prompted ASAP');
  check((await text(p, '#timer-subline')).includes('DUE'), 'timer sub-line shows adrenaline due');
  await p.click('button[data-drug="adrenaline"]');
  check(!(await text(p, '#guidance-content')).includes('Give adrenaline'), 'prompt clears after adrenaline given');
  await p.clock.runFor(121000);
  check(await S(p, () => state.currentStep) === 'ASSESS_RHYTHM', 'cycle ends after 2 min (clock-based timer)');
  await p.click('#rhythm-pea-btn');
  check(!(await text(p, '#guidance-content')).includes('Give adrenaline'), 'adrenaline not yet due at 2 min');
  await p.clock.runFor(61000);
  check((await text(p, '#guidance-content')).includes('Give adrenaline'), 'adrenaline due again after 3 min (updates mid-cycle)');
  await p.clock.runFor(60000);
  check(await p.isHidden('#cycle-reset-btn'), 'cycle reset button hidden outside CPR');

  // shockable path: amiodarone + pad vector after 3 shocks, energy recorded
  for (let i = 0; i < 3; i++) {
    await p.click('#rhythm-vf-btn');
    if (i === 0) await p.click('button[data-energy="200"]');
    await p.click('#deliver-shock-btn');
    if (i < 2) await p.clock.runFor(121000);
  }
  const g = await text(p, '#guidance-content');
  check(g.includes('Give amiodarone 300 mg') && g.includes('pad position'), 'after 3rd shock: amiodarone 300 + pad vector prompts', g);
  check((await log(p)).includes('Shock 1 delivered (200 J)'), 'adult shock energy recorded when chosen');
  await p.click('button[data-drug="amiodarone"]');
  check((await log(p)).includes('Amiodarone 300 mg given'), 'amiodarone 300 logged first');
  check(!(await text(p, '#guidance-content')).includes('amiodarone 300'), 'amiodarone prompt clears once given');

  // undo marks entry as entered in error (not deleted)
  await p.click('button[data-drug="amiodarone"] .decrement-btn');
  check(await S(p, () => state.log.find(e => e.key === 'amiodarone').voided === true), 'undo voids entry, keeps it in the record');
  check((await text(p, '#guidance-content')).includes('Give amiodarone 300 mg'), 'after undo, amiodarone 300 prompted again');

  // End arrest requires confirmation and actually ends
  await p.click('#end-arrest-btn');
  check(await p.isVisible('#app-dialog'), 'End Arrest asks for confirmation');
  await dialogChoose(p, 'Cancel');
  check(await S(p, () => state.isArrestActive), 'cancel keeps arrest running');
  await p.click('#end-arrest-btn');
  await dialogChoose(p, 'Resuscitation stopped');
  check(await S(p, () => [state.currentStep, state.isArrestActive, state.isCprInProgress].join()) === 'ENDED,false,false', 'End Arrest ends the episode');
  check(await p.isHidden('#rosc-btn') && await p.isDisabled('#end-arrest-btn'), 'ROSC hidden and End disabled after end');
  const sum = await text(p, '#summary-content');
  check(sum.includes('Resuscitation stopped') && /\d{2}\/\d{2}\/\d{4}/.test(sum), 'summary shows outcome and date', sum.slice(0, 200));
  await closeModal(p);
  await p.click('#view-summary-btn');
  check((await text(p, '#summary-content')).includes('Resuscitation stopped'), 'header Summary button shows real outcome');
  await closeModal(p);
  await p.click('button[data-action="undo-end"]');
  check(await S(p, () => state.isArrestActive && state.currentStep === 'ASSESS_RHYTHM'), 'ended-by-mistake can be resumed');

  // Print: full log, record-only
  await p.click('#log-tab');
  await p.evaluate(() => { window.__printed = 0; window.print = () => window.__printed++; });
  await p.click('#print-log-btn');
  check(await S(p, () => window.__printed) === 1, 'Event Log Print button prints');
  await p.emulateMedia({ media: 'print' });
  const logBox = await p.locator('.summary-log').evaluate(el => el.scrollHeight <= el.clientHeight + 1);
  check(logBox, 'printed event log is not truncated');
  await p.emulateMedia({ media: 'screen' });

  // Copy: clipboard fallback path
  await p.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('blocked')); document.execCommand = () => false; });
  await p.click('#copy-log-btn');
  check(await p.isVisible('#manual-copy'), 'copy falls back to manual-copy dialog when clipboard blocked');
  const copied = await p.inputValue('#manual-copy');
  check(copied.includes('RESUSCITATION RECORD') && copied.includes('Date:') && copied.includes('T+'), 'record text has date and elapsed times');
  await dialogChoose(p, 'Done');

  // Metronome works without any external library
  await p.click('#metronome-btn');
  check((await text(p, '#metronome-btn')).includes('On'), 'metronome toggles on');
  await p.click('#metronome-btn');
  check(p.errs.length === 0, 'no page errors (adult flow)', p.errs.join(' | '));

  // New Patient uses in-page dialog (works where confirm() is blocked)
  await p.click('#reset-app-btn');
  await dialogChoose(p, 'Clear record');
  check(await S(p, () => state.currentStep === 'START' && !state.startTime), 'New Patient resets via in-page dialog');

  // --- Reset cycle timer cannot flip ROSC / START screens
  p = await fresh();
  check(await p.isHidden('#cycle-reset-btn'), 'reset timer hidden before start');
  await p.evaluate(() => resetCycleTimer());
  await p.clock.runFor(121000);
  check(await S(p, () => state.currentStep) === 'START', 'resetCycleTimer ignored before start');
  await p.click('#start-arrest-btn'); await p.click('#rhythm-asys-btn'); await p.click('#rosc-btn');
  await p.evaluate(() => resetCycleTimer());
  await p.clock.runFor(121000);
  check(await S(p, () => state.currentStep) === 'POST_ROSC', 'resetCycleTimer ignored post-ROSC');
  check(!(await p.isVisible('#summary-modal')), 'ROSC does not cover post-ROSC guidance with a modal');

  // --- Rearrest: outcome ongoing, arrest time excludes ROSC period
  await p.click('#rearrest-btn');
  await p.clock.runFor(30000);
  await p.click('#view-summary-btn');
  const rs = await text(p, '#summary-content');
  check(rs.includes('In progress') && rs.includes('Re-arrest'), 'summary during rearrest shows In progress + timeline', rs.slice(0, 300));
  const secs = await S(p, () => arrestSeconds());
  check(secs >= 29 && secs <= 32, 'arrest time excludes the ROSC interval', String(secs));
  await closeModal(p);

  // --- Persistence: reload mid-arrest restores automatically
  const ctx = p.context();
  await p.close();
  const p2 = await ctx.newPage();
  p2.errs = [];
  p2.on('pageerror', e => p2.errs.push(e.message));
  await p2.goto(url);
  check(await S(p2, () => state.isArrestActive && state.rearrestTimes.length === 1), 'page reload restores the arrest in progress');
  check((await log(p2)).some(m => m.includes('restored after page reload')), 'restore is logged');
  await ctx.close();

  // --- Neonatal flow
  p = await fresh();
  await p.click('button[data-mode="NEO"]');
  check(await p.isHidden('#pre-arrested-btn'), 'NEO: no "arrived in arrest" option');
  await p.click('#start-arrest-btn');
  check(await S(p, () => state.currentStep) === 'NEO_AIRWAY', 'NEO starts with airway/inflation breaths');
  check((await log(p)).some(m => m.includes('3.5 kg (assumed')), 'NEO: assumed weight is recorded as assumed');
  await p.click('#neo-inflation-btn');
  await p.click('#neo-chest-btn');
  check((await text(p, '#guidance-content')).includes('Chest not moving'), 'NEO: chest not moving → airway manoeuvres');
  await p.click('#neo-inflation-btn');
  await p.click('#neo-hr-ge60-btn');
  check(await S(p, () => state.currentStep === 'PERFORMING_CPR' && state.neoPhase === 'VENT'), 'NEO: HR ≥ 60 → ventilation (no shock, no compressions)');
  await p.clock.runFor(31000);
  await p.click('#neo-hr-lt60-btn');
  check(await S(p, () => state.neoPhase) === 'CPR', 'NEO: HR < 60 → compressions');
  check(!(await text(p, '#guidance-content')).toLowerCase().includes('shock'), 'NEO: never shows a shock screen');
  await p.clock.runFor(31000);
  await p.click('#neo-hr-lt60-btn');
  check((await text(p, '#guidance-content')).includes('Give adrenaline 70 mcg'), 'NEO: adrenaline 20 mcg/kg prompted after compressions fail');
  check((await text(p, '#patient-info-display')).includes('Glucose 10%: 8.8 ml (2.5 ml/kg)'), 'NEO glucose 2.5 ml/kg');
  check(p.errs.length === 0, 'no page errors (NEO)', p.errs.join(' | '));

  // --- Paediatric doses
  p = await fresh();
  await p.click('button[data-mode="PAEDS"]');
  const ageWeight = async (age) => { await p.fill('#input-age', String(age)); await p.click('button[data-action="calc-age"]'); return S(p, () => state.patientWeight); };
  check(await ageWeight(0.5) === 7, 'APLS weight 6 months = 7 kg');
  check(await ageWeight(5) === 18, 'APLS weight 5 yr = 18 kg');
  check(await ageWeight(6) === 25, 'APLS weight 6 yr = 25 kg');
  check(await ageWeight(10) === 37, 'APLS weight 10 yr = 37 kg');
  check(await ageWeight(11) === 40, 'APLS weight 11 yr = 40 kg');
  p = await fresh();
  await p.click('button[data-mode="PAEDS"]');
  await p.fill('#input-weight', '120'); await p.locator('#input-weight').blur();
  let wf = await text(p, '#wetflag-results');
  check(wf.includes('1000 mcg') && wf.includes('capped at 1 mg') && wf.includes('300 mg') && wf.includes('adult dose'), 'paeds dose caps (adrenaline 1 mg, amiodarone 300 mg, energy)', wf);
  check(wf.includes('enter age for tube size'), 'no tube size shown when age unknown');
  await p.fill('#input-weight', '20'); await p.locator('#input-weight').blur();
  await p.click('#start-arrest-btn');
  await p.click('#rhythm-asys-btn');
  check((await text(p, '#guidance-content')).includes('Give adrenaline 200 mcg'), 'paeds non-shockable: adrenaline prompted');
  await p.click('button[data-drug="fluids"]');
  check((await log(p)).includes('Fluid 200 ml (10 ml/kg) given'), 'paeds fluid labelled 10 ml/kg');
  await p.click('button[data-drug="glucose"]');
  await p.click('#view-summary-btn');
  check((await text(p, '#summary-content')).includes('Glucose ×1'), 'glucose appears in summary totals');
  await closeModal(p);

  // --- Weight does not leak across protocols
  p = await fresh();
  await p.click('button[data-mode="PAEDS"]');
  await p.fill('#input-weight', '20'); await p.locator('#input-weight').blur();
  await p.click('button[data-mode="ADULT"]');
  await p.click('#start-arrest-btn'); await p.click('#rhythm-vf-btn');
  check(!(await text(p, '#guidance-content')).includes('80'), 'paeds weight not used for adult energy');
  await p.click('#deliver-shock-btn');
  check((await log(p)).includes('Shock 1 delivered'), 'adult shock logged without paeds energy');

  // --- Special circumstances adapt prompts
  p = await fresh();
  await p.click('#start-arrest-btn');
  await p.click('#special-circs-tab');
  await p.click('[data-circ="hypothermia-severe"]');
  await p.click('#guidance-tab');
  await p.click('#rhythm-pea-btn');
  check((await text(p, '#guidance-content')).includes('withhold adrenaline'), 'hypothermia < 30: adrenaline withheld');

  // --- Escaping of free text
  await p.fill('#custom-intervention-input', '<b>K+</b> 7.1');
  await p.click('#add-intervention-btn');
  check((await p.locator('#log-content').innerHTML()).includes('&lt;b&gt;K+'), 'notes are HTML-escaped');

  // --- Mobile: rhythm buttons visible without scrolling
  p = await fresh({ width: 390, height: 844 });
  await p.click('#start-arrest-btn');
  const box = await p.locator('#rhythm-vf-btn').boundingBox();
  check(box && box.y + box.height < 844, 'mobile: rhythm buttons on first screen', JSON.stringify(box));
  const overflow = await S(p, () => document.documentElement.scrollWidth > window.innerWidth);
  check(!overflow, 'mobile: no horizontal overflow');
  await p.screenshot({ path: path.join(root, 'tools', `.mobile-${file}.png`) }).catch(() => {});
  check(p.errs.length === 0, 'no page errors (mobile)', p.errs.join(' | '));
}

await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
