// Generates 1200x630 social share cards (og:image) for every page into src/og/.
// Run locally after adding terms:
//   npm i --no-save playwright @fontsource/big-shoulders-display @fontsource/ibm-plex-mono
//   npx playwright install chromium
//   node build.mjs --cards /tmp/cards.json && node scripts/og-cards.mjs /tmp/cards.json
// Pages without a card fall back to src/og/default.jpg.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const cards = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = new URL('../src/og/', import.meta.url).pathname;
const FONTS = process.env.FONT_DIR || path.dirname(require.resolve('@fontsource/big-shoulders-display/package.json')) + '/../';
const f = (pkg, file) => 'data:font/woff2;base64,' + fs.readFileSync(path.join(FONTS, pkg, 'files', file)).toString('base64');
const css = `
@font-face{font-family:BS;font-weight:900;src:url(${f('big-shoulders-display', 'big-shoulders-display-latin-900-normal.woff2')})}
@font-face{font-family:BS;font-weight:800;src:url(${f('big-shoulders-display', 'big-shoulders-display-latin-800-normal.woff2')})}
@font-face{font-family:PM;font-weight:400;src:url(${f('ibm-plex-mono', 'ibm-plex-mono-latin-400-normal.woff2')})}
@font-face{font-family:PM;font-weight:600;src:url(${f('ibm-plex-mono', 'ibm-plex-mono-latin-600-normal.woff2')})}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;background:linear-gradient(90deg,#8e908b 50%,#1c1d1e 50%);font-family:PM;position:relative}
.tex{position:absolute;top:0;bottom:0;width:600px;overflow:hidden;font:500 13px/1.55 PM;word-break:break-all;padding:8px 12px}
.tex.a{left:0;color:#2a2b2a;opacity:.12}.tex.b{right:0;color:#00e85b;opacity:.08}
.logo{position:absolute;top:34px;left:44px;font:900 34px/1 BS;text-transform:uppercase;letter-spacing:.01em}
.logo .de{color:#5d605c}.logo .dup{color:#141515}.logo .tld{color:#141515}
.cat{position:absolute;top:40px;right:44px;font:600 16px PM;color:#00e85b;text-transform:uppercase;letter-spacing:.1em}
.word{position:absolute;left:0;right:0;top:118px;text-align:center;font:900 var(--fs)/0.9 BS;text-transform:uppercase;letter-spacing:-.01em;white-space:nowrap;
  color:transparent;-webkit-background-clip:text;background-clip:text;background-image:linear-gradient(90deg,#f1f2ee 0 calc(100% - var(--dup)),#00e85b calc(100% - var(--dup)) 100%);
  -webkit-text-stroke:2px rgba(0,0,0,.25);width:max-content;margin:0 auto}
.word.nodata{background-image:none;color:#f1f2ee}
.lab{position:absolute;top:392px;width:520px;font:800 38px/1.05 BS;text-transform:uppercase}
.lab.a{left:44px;color:#f1f2ee}.lab.b{right:44px;text-align:right;color:#a9aba6}
.lab small{display:block;font:600 14px PM;letter-spacing:.12em;margin-bottom:8px}
.lab.a small{color:#2a2b2a}.lab.b small{color:#00e85b}
.bar{position:absolute;left:0;right:0;bottom:0;height:78px;display:grid;grid-template-columns:max(110px,calc(100% - var(--dup))) minmax(110px,1fr);font:900 40px/78px BS}
.bar span{padding:0 28px;overflow:hidden;white-space:nowrap}
.bar .a{background:#aeb1aa;color:#141515}.bar .b{background:#00e85b;color:#141515;text-align:right}
.bar.c .a,.bar.c .b{background:#ffb300}
.verdict{position:absolute;bottom:96px;left:50%;transform:translateX(-50%) rotate(-2deg);font:600 17px PM;text-transform:uppercase;letter-spacing:.12em;padding:9px 14px;border:2px solid;white-space:nowrap;background:rgba(20,21,21,.8)}
.v-b{color:#00e85b}.v-a{color:#f1f2ee}.v-c{color:#ffb300}.v-n{color:#a9aba6}
.page{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 70px}
.page h1{font:900 118px/.9 BS;text-transform:uppercase;color:#f1f2ee;max-width:1060px}
.page p{font:400 26px/1.4 PM;color:#d9dbd5;margin-top:26px;max-width:1000px}
`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const short = s => s.replace(/ \(.*\)$/, '');
function termHTML(c) {
  const dup = c.share == null ? 50 : Math.round(c.share * 100);
  const cls = c.share == null ? 'n' : c.share > .6 ? 'b' : c.share < .4 ? 'a' : 'c';
  const verdict = { b: 'Duplicate owns the word →', a: '← Original still owns the word', c: 'Contested', n: 'Not enough data yet' }[cls];
  const len = c.term.length, fs = Math.min(230, Math.floor(1080 / (len * 0.52)));
  return `
<div class="logo"><span class="de">de</span><span class="dup">duplication</span><span class="tld">.tech</span></div><div class="cat">${esc(c.cat)}</div>
<div class="word${c.share == null ? ' nodata' : ''}" style="--fs:${fs}px;--dup:${dup}%">${esc(c.term)}</div>
<div class="lab a"><small>ORIGINAL</small>${esc(c.a)}</div><div class="lab b"><small>DUPLICATE</small>${esc(c.b)}</div>
<div class="verdict v-${cls}">${verdict}</div>
${c.share == null ? '' : `<div class="bar${cls === 'c' ? ' c' : ''}" style="--dup:${dup}%"><span class="a">${100 - dup}%</span><span class="b">${dup}%</span></div>`}`;
}
function pageHTML(title, desc) {
  return `<div class="logo" style="z-index:2"><span class="de">de</span><span class="dup" style="color:#f1f2ee;mix-blend-mode:difference">duplication</span><span class="tld" style="color:#00e85b">.tech</span></div>
<div class="page" style="background:#141515"><h1>${esc(title)}</h1><p>${esc(desc)}</p></div>`;
}
const pages = [
  ['default', 'Which meaning owns the word?', 'Words with two meanings, measured with data. A HackerNoon project.'],
  ['home', 'Which meaning owns the word?', `${cards.length} duplicated terms in tech, science and media, measured with Wikipedia attention.`],
  ['about', 'About Deduplication Technology', 'How HackerNoon measures which meaning of a word is winning.'],
  ['methodology', 'Methodology', 'Sources, verdict thresholds and limits.'],
  ['terms', `All ${cards.length} terms`, 'Every duplicated word, A to Z.'],
];
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
const shot = async (file, inner) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.setContent(`<!doctype html><style>${css}</style>${inner}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file, type: 'jpeg', quality: 80 });
};
for (const [name, t, d] of pages) await shot(OUT + name + '.jpg', pageHTML(t, d));
let n = 0;
for (const c of cards) { await shot(OUT + c.path + '.jpg', termHTML(c)); if (++n % 100 === 0) console.log(n); }
await browser.close();
console.log('cards written:', n + pages.length);
