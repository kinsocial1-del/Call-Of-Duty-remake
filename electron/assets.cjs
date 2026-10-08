const path = require('node:path');

function resolveGameAsset(root, requestUrl) {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== 'app:' || url.hostname !== 'game') return null;
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\0') || pathname.includes('\\')) return null;
    const file = path.resolve(root, '.' + pathname);
    const relative = path.relative(root, file);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null;
    return file;
  } catch { return null; }
}

module.exports = { resolveGameAsset };
