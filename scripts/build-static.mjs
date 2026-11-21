import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(rootDir, 'dist');

const ignoredDirs = new Set(['.agents', '.claude', '.codex', '.git', '.netlify', 'dist', 'node_modules', 'scripts']);
const ignoredFiles = new Set(['package-lock.json', 'package.json']);
const copiedExtensions = new Set([
  '.html',
  '.css',
  '.js',
  '.mjs',
  '.json',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.svg',
  '.ico',
  '.txt',
  '.xml',
  '.webmanifest',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf'
]);
const rewriteExtensions = new Set(['.html', '.css', '.js', '.mjs']);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(rootDir, fullPath);

    if (entry.isDirectory()) {
      return ignoredDirs.has(entry.name) ? [] : walk(fullPath);
    }

    if (!entry.isFile()) return [];
    if (ignoredFiles.has(entry.name)) return [];
    return copiedExtensions.has(path.extname(entry.name).toLowerCase()) ? [relativePath] : [];
  });
}

function rewriteRelativePaths(content) {
  return content
    .replace(/((?:href|src|poster|action)\s*=\s*["'])\/(?!\/|#)([^"']+)/gi, '$1./$2')
    .replace(/url\(\s*(["']?)\/(?!\/)([^)"']+)\1\s*\)/gi, 'url($1./$2$1)');
}

function findRootAbsoluteReferences(content, filePath) {
  const patterns = [
    /(?:href|src|poster|action)\s*=\s*["']\/(?!\/|#)[^"']+/gi,
    /url\(\s*["']?\/(?!\/)[^)]+/gi
  ];

  return patterns.flatMap((pattern) =>
    [...content.matchAll(pattern)].map((match) => `${filePath}: ${match[0]}`)
  );
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const copiedFiles = walk(rootDir);
const violations = [];

for (const relativePath of copiedFiles) {
  const sourcePath = path.join(rootDir, relativePath);
  const targetPath = path.join(outDir, relativePath);
  const targetDir = path.dirname(targetPath);

  mkdirSync(targetDir, { recursive: true });

  if (rewriteExtensions.has(path.extname(relativePath).toLowerCase())) {
    const rewritten = rewriteRelativePaths(readFileSync(sourcePath, 'utf8'));
    writeFileSync(targetPath, rewritten);
    violations.push(...findRootAbsoluteReferences(rewritten, relativePath));
  } else {
    cpSync(sourcePath, targetPath);
  }
}

for (const requiredFile of ['index.html', 'admin.html']) {
  if (!existsSync(path.join(outDir, requiredFile))) {
    throw new Error(`Missing ${requiredFile} in ${path.relative(rootDir, outDir)}`);
  }
}

if (violations.length > 0) {
  console.error('Build failed: root-relative local paths remain in the static output.');
  console.error(violations.join('\n'));
  process.exit(1);
}

const totalBytes = copiedFiles.reduce((sum, file) => sum + statSync(path.join(outDir, file)).size, 0);

console.log(`Built ${copiedFiles.length} static files to ${path.relative(rootDir, outDir)}/`);
console.log(`Output size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
console.log('All local asset references are relative-path safe for subdirectory hosting.');
