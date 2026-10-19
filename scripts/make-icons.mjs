// Rasterize public/icon.svg into PWA / store icons.
import sharp from 'sharp';
import fs from 'node:fs';
const svg = fs.readFileSync('public/icon.svg');
for (const s of [192, 512]) await sharp(svg).resize(s, s).png().toFile(`public/icons/icon-${s}.png`);
// Maskable: logo inside the 80% safe zone on a solid background.
const inner = await sharp(svg).resize(410, 410).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#05080c' } }).composite([{ input: inner, gravity: 'center' }]).png().toFile('public/icons/maskable-512.png');
await sharp(svg).resize(180, 180).flatten({ background: '#05080c' }).png().toFile('public/icons/apple-touch-icon.png');
await sharp(svg).resize(48, 48).png().toFile('public/favicon-48.png');
console.log('icons ok');
