const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const distPath = path.join(root, 'dist');
const src = path.join(distPath, 'latest-mac.yml');
const dest = path.join(distPath, 'latest-mac-x64.yml');

if (!fs.existsSync(src)) {
  console.error('[stash-mac-yml] latest-mac.yml not found.');
  process.exit(1);
}

fs.copyFileSync(src, dest);
console.log('[stash-mac-yml] Saved latest-mac.yml as latest-mac-x64.yml');
