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

function removeNestedLayouts() {
  // We intentionally keep the shell/layout in a single place (app/layout.tsx + RootShell/AppLayout).
  // Nested route layouts like app/<route>/layout.tsx can cause duplicated sidebars and hydration issues.
  try {
    if (!fs.existsSync('app')) return 0;
    const entries = fs.readdirSync('app', { withFileTypes: true });
    let removed = 0;
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const p = path.join('app', ent.name, 'layout.tsx');
      if (fs.existsSync(p)) {
        try {
          fs.rmSync(p, { force: true });
          removed += 1;
        } catch {
          // ignore
        }
      }
    }
    return removed;
  } catch {
    return 0;
  }
}

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

removed += removeNestedLayouts();

if (removed > 0) {
  // eslint-disable-next-line no-console
  console.log(`🧹 Removed ${removed} Next icon override file(s) from /app to prevent metadata override.`);
}


