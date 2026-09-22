import { readdir, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
let total = 0;
async function walk(path) { for (const file of await readdir(path, { withFileTypes: true })) { const p = `${path}/${file.name}`; if (file.isDirectory()) await walk(p); else if (/\.(html|js|css|svg)$/.test(p)) total += gzipSync(await readFile(p)).length; } }
await walk('dist');
console.log(`All application assets, gzip: ${(total / 1024).toFixed(1)} KiB (budget: 150 KiB)`);
if (total > 150 * 1024) process.exitCode = 1;
