import { copyFile, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export async function copyStaticExportPackageFile(
  packageRoot: string,
  folder: string,
  sourcePath: string,
  files: string[],
  warnings: Set<string>,
  targetPath = sourcePath,
): Promise<boolean> {
  const cleanSource = cleanManifestPath(sourcePath);
  const cleanTarget = cleanManifestPath(targetPath);
  if (!cleanSource || !cleanTarget) {
    warnings.add(`Skipped unsafe manifest path: ${sourcePath}`);
    return false;
  }
  const source = resolveInside(packageRoot, cleanSource);
  const target = resolveInside(folder, cleanTarget);
  if (!source || !target) {
    warnings.add(`Skipped unsafe manifest path: ${sourcePath}`);
    return false;
  }
  try {
    const stats = await stat(source);
    if (!stats.isFile()) return false;
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    files.push(cleanTarget);
    return true;
  } catch (err) {
    if (isAbsenceError(err)) return false;
    throw err;
  }
}

export async function readStaticExportPackageText(
  packageRoot: string,
  sourcePath: string | undefined,
  warnings: Set<string>,
): Promise<string | undefined> {
  if (!sourcePath) return undefined;
  const clean = cleanManifestPath(sourcePath);
  if (!clean) {
    warnings.add(`Skipped unsafe manifest path: ${sourcePath}`);
    return undefined;
  }
  const source = resolveInside(packageRoot, clean);
  if (!source) {
    warnings.add(`Skipped unsafe manifest path: ${sourcePath}`);
    return undefined;
  }
  try {
    return await readFile(source, 'utf8');
  } catch (err) {
    if (isAbsenceError(err)) return undefined;
    throw err;
  }
}

export async function copyStaticExportAssetDir(
  packageRoot: string,
  folder: string,
  assetsDir: string,
  files: string[],
  warnings: Set<string>,
): Promise<void> {
  const cleanDir = cleanManifestPath(assetsDir);
  if (!cleanDir) {
    warnings.add(`Skipped unsafe assetsDir: ${assetsDir}`);
    return;
  }
  const sourceDir = resolveInside(packageRoot, cleanDir);
  if (!sourceDir) return;
  await copyDir(sourceDir, folder, cleanDir, files);
}

export async function listStaticExportPreviewPages(packageRoot: string): Promise<string[]> {
  const previewDir = path.join(packageRoot, 'preview');
  let entries;
  try {
    entries = await readdir(previewDir, { withFileTypes: true });
  } catch (err) {
    if (isAbsenceError(err)) return [];
    throw err;
  }
  return entries
    .filter((entry) => entry.isFile() && /\.html?$/iu.test(entry.name))
    .map((entry) => toPosixPath(path.posix.join('preview', entry.name)))
    .sort();
}

export function slugifyStaticExportName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'design-system';
}

export function staticExportStamp(value: Date): string {
  return value.toISOString().replace(/[:.]/g, '-');
}

export function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/');
}

export function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

async function copyDir(sourceDir: string, folder: string, relativeDir: string, files: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch (err) {
    if (isAbsenceError(err)) return;
    throw err;
  }
  for (const entry of entries) {
    const relativePath = toPosixPath(path.posix.join(relativeDir, entry.name));
    const source = path.join(sourceDir, entry.name);
    const target = path.join(folder, relativePath);
    if (entry.isDirectory()) await copyDir(source, folder, relativePath, files);
    if (entry.isFile()) {
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
      files.push(relativePath);
    }
  }
}

function cleanManifestPath(raw: string): string | null {
  const normalized = path.posix.normalize(raw.replace(/\\/g, '/').trim());
  if (!normalized || normalized === '.' || normalized === '..') return null;
  if (normalized.startsWith('../') || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return null;
  return normalized;
}

function resolveInside(root: string, relativePath: string): string | null {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  return target === resolvedRoot || target.startsWith(`${resolvedRoot}${path.sep}`) ? target : null;
}

function isAbsenceError(err: unknown): boolean {
  return isNodeError(err) && (err.code === 'ENOENT' || err.code === 'ENOTDIR');
}
