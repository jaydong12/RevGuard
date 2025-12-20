import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

async function main() {
  const svgPath = fileURLToPath(new URL('../public/revguard-r.svg', import.meta.url));
  const iconPath = fileURLToPath(new URL('../public/icon.png', import.meta.url));
  const faviconPath = fileURLToPath(new URL('../public/favicon.ico', import.meta.url));

  const svg = await fs.readFile(svgPath);

  // icon.png (512x512)
  await sharp(svg, { density: 512 })
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(iconPath);

  // favicon.ico (16x16 + 32x32)
  const png32 = await sharp(svg, { density: 256 })
    .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const png16 = await sharp(svg, { density: 256 })
    .resize(16, 16, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const ico = await pngToIco([png16, png32]);
  await fs.writeFile(faviconPath, ico);

  console.log('✅ Generated public/icon.png and public/favicon.ico');
}

main().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});


