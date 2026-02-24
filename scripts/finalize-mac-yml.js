const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const distPath = path.join(root, 'dist');
const armSrc = path.join(distPath, 'latest-mac.yml');
const armDest = path.join(distPath, 'latest-mac-arm64.yml');
const x64Src = path.join(distPath, 'latest-mac-x64.yml');
const x64Dest = path.join(distPath, 'latest-mac.yml');

if (!fs.existsSync(armSrc)) {
  console.error('[finalize-mac-yml] latest-mac.yml not found after arm64 build.');
  process.exit(1);
}

fs.renameSync(armSrc, armDest);

if (fs.existsSync(x64Src)) {
  fs.renameSync(x64Src, x64Dest);
} else {
  console.warn('[finalize-mac-yml] latest-mac-x64.yml not found; leaving latest-mac.yml as arm64.');
}

const parseYaml = (content) => {
  const lines = content.split(/\r?\n/);
  const entries = {};
  let currentUrl = null;
  for (const line of lines) {
    const urlMatch = line.match(/^\s*-\s+url:\s+(.+)$/);
    if (urlMatch) {
      currentUrl = urlMatch[1].trim();
      if (!entries[currentUrl]) {
        entries[currentUrl] = {};
      }
      continue;
    }
    if (!currentUrl) continue;
    const shaMatch = line.match(/^\s*sha512:\s+(.+)$/);
    if (shaMatch) {
      entries[currentUrl].sha512 = shaMatch[1].trim();
      continue;
    }
    const sizeMatch = line.match(/^\s*size:\s+(\d+)$/);
    if (sizeMatch) {
      entries[currentUrl].size = sizeMatch[1].trim();
    }
  }
  return entries;
};

const syncArm64Entries = () => {
  if (!fs.existsSync(armDest) || !fs.existsSync(x64Dest)) return;
  const armContent = fs.readFileSync(armDest, 'utf8');
  const x64Content = fs.readFileSync(x64Dest, 'utf8');
  const armEntries = parseYaml(armContent);
  const lines = x64Content.split(/\r?\n/);
  let currentUrl = null;
  const updated = lines.map((line) => {
    const urlMatch = line.match(/^\s*-\s+url:\s+(.+)$/);
    if (urlMatch) {
      currentUrl = urlMatch[1].trim();
      return line;
    }
    if (currentUrl && armEntries[currentUrl]) {
      const shaMatch = line.match(/^\s*sha512:\s+(.+)$/);
      if (shaMatch) {
        return line.replace(shaMatch[1], armEntries[currentUrl].sha512 || shaMatch[1]);
      }
      const sizeMatch = line.match(/^\s*size:\s+(\d+)$/);
      if (sizeMatch) {
        return line.replace(sizeMatch[1], armEntries[currentUrl].size || sizeMatch[1]);
      }
    }
    return line;
  });
  fs.writeFileSync(x64Dest, updated.join('\n'));
};

syncArm64Entries();

console.log('[finalize-mac-yml] Wrote latest-mac-arm64.yml and restored latest-mac.yml');
