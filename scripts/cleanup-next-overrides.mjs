import fs from 'node:fs';
import path from 'node:path';

const candidates = [
  path.join('app', 'favicon.ico'),
  path.join('app', 'icon.png'),
  path.join('app', 'icon.jpg'),
  path.join('app', 'icon.jpeg'),
  path.join('app', 'icon.svg'),
  path.join('app', 'icon.tsx'),
  path.join('app', 'icon.jsx'),
];

let removed = 0;
for (const p of candidates) {
  try {
    if (fs.existsSync(p)) {
      fs.rmSync(p, { force: true });
      removed += 1;
    }
  } catch {
    // ignore
  }
}

if (removed > 0) {
  // eslint-disable-next-line no-console
  console.log(`🧹 Removed ${removed} Next icon override file(s) from /app to prevent metadata override.`);
}


