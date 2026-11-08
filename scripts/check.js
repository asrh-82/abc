const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const roots = ['src', 'scripts', 'test'];

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(filename);
    return entry.isFile() && entry.name.endsWith('.js') ? [filename] : [];
  });
}

const files = roots.flatMap((root) => javascriptFiles(path.join(projectRoot, root))).sort();
for (const filename of files) {
  const result = spawnSync(process.execPath, ['--check', filename], { stdio: 'inherit' });
  if (result.status !== 0) process.exitCode = 1;
}

if (!process.exitCode) console.log(`Checked ${files.length} JavaScript files.`);
