/**
 * Copies the game into app/ for packaging and swaps the Google Fonts link for
 * the bundled copies in fonts/, so the desktop game looks right offline.
 */

const fs = require('node:fs');
const path = require('node:path');

const here = __dirname;
const out = path.join(here, 'app');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

let html = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');
const fontsDir = path.join(here, 'fonts');
if (fs.existsSync(path.join(fontsDir, 'fonts.css'))) {
  fs.cpSync(fontsDir, path.join(out, 'fonts'), { recursive: true });
  html = html
    .replace(/<link rel="preconnect"[^>]*>\n/g, '')
    .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, '<link rel="stylesheet" href="fonts/fonts.css">');
}
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log('Prepared app/ from ../index.html');
