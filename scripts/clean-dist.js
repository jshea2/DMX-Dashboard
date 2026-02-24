const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const distPath = path.join(root, 'dist');

if (fs.existsSync(distPath)) {
  fs.rmSync(distPath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200
  });
}

fs.mkdirSync(distPath, { recursive: true });
console.log('[clean-dist] dist/ cleared');
