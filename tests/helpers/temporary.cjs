const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function temporaryDirectory(t, prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

module.exports = { temporaryDirectory };
