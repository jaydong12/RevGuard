import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

async function main() {
  const logoPath = fileURLToPath(new URL('../public/logo.png', import.meta.url));
  const faviconPath = fileURLToPath(new URL('../public/favicon.ico', import.meta.url));

  const logo = await fs.readFile(logoPath);

  // favicon.ico (16x16 + 32x32)
  const png32 = await sharp(logo)
    .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const png16 = await sharp(logo)
    .resize(16, 16, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const ico = await pngToIco([png16, png32]);
  await fs.writeFile(faviconPath, ico);

  console.log('✅ Generated public/favicon.ico from public/logo.png');
}

main().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});


