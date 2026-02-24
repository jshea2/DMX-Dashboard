const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const distPath = path.join(root, 'dist');
const outPath = path.join(distPath, 'release');

const keepPatterns = [
  /-Mac-(arm64|x64)\.dmg$/i,
  /-Mac-(arm64|x64)\.dmg\.blockmap$/i,
  /-Mac-(arm64|x64)\.zip$/i,
  /-Mac-(arm64|x64)\.zip\.blockmap$/i,
  /-Win-x64\.exe$/i,
  /-Win-x64\.exe\.blockmap$/i,
  /-Linux-x86_64\.AppImage$/i,
  /-Linux-x86_64\.AppImage\.blockmap$/i,
  /^latest\.yml$/i,
  /^latest-mac\.yml$/i,
  /^latest-mac-arm64\.yml$/i,
  /^latest-linux\.yml$/i
];

const shouldKeep = (name) => keepPatterns.some((re) => re.test(name));

if (!fs.existsSync(distPath)) {
  console.error('[collect-release] dist/ not found. Run the build first.');
  process.exit(1);
}

fs.mkdirSync(outPath, { recursive: true });

const entries = fs.readdirSync(distPath);
const kept = [];
entries.forEach((entry) => {
  const src = path.join(distPath, entry);
  if (!fs.statSync(src).isFile()) return;
  if (!shouldKeep(entry)) return;

  const dest = path.join(outPath, entry);
  fs.copyFileSync(src, dest);
  kept.push(entry);
});

kept.sort();
console.log('[collect-release] Copied files to dist/release:');
kept.forEach((name) => console.log(`- ${name}`));
