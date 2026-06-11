import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DesignSystemStaticExportError,
  exportDesignSystemStaticHtml,
} from '../src/design-system-static-export.js';
import { createUserDesignSystem } from '../src/design-systems.js';

describe('exportDesignSystemStaticHtml', () => {
  let root: string;
  let builtInRoot: string;
  let userRoot: string;
  let outRoot: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'od-design-system-static-export-'));
    builtInRoot = path.join(root, 'design-systems');
    userRoot = path.join(root, 'user-design-systems');
    outRoot = path.join(root, 'exports');
    await mkdir(builtInRoot, { recursive: true });
    await mkdir(userRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('exports a full package with standalone review pages, data, and relative assets', async () => {
    const systemDir = path.join(builtInRoot, 'acme');
    await mkdir(path.join(systemDir, 'preview'), { recursive: true });
    await mkdir(path.join(systemDir, 'assets'), { recursive: true });
    await mkdir(path.join(systemDir, 'source'), { recursive: true });
    await writeFile(path.join(systemDir, 'DESIGN.md'), '# Acme\n\n> Category: Product\n\nUse dense review workflows.\n');
    await writeFile(path.join(systemDir, 'tokens.css'), ':root { --accent: #3366ff; }\n');
    await writeFile(path.join(systemDir, 'components.html'), '<button class="primary">Review</button>\n');
    await writeFile(path.join(systemDir, 'components.manifest.json'), '{"components":[{"name":"Button"}]}\n');
    await writeFile(path.join(systemDir, 'preview', 'overview.html'), '<!doctype html><p>Preview</p>\n');
    await writeFile(path.join(systemDir, 'assets', 'logo.svg'), '<svg role="img"></svg>\n');
    await writeFile(path.join(systemDir, 'source', 'evidence.md'), 'Scanned source evidence.\n');
    await writeFile(path.join(systemDir, 'source', 'report.json'), '{"summary":{"grade":"usable","score":82}}\n');
    await writeFile(
      path.join(systemDir, 'manifest.json'),
      `${JSON.stringify({
        schemaVersion: 'od-design-system-project/v1',
        id: 'acme',
        name: 'Acme',
        category: 'Product',
        description: 'Internal product system.',
        files: {
          design: 'DESIGN.md',
          tokens: 'tokens.css',
          components: 'components.html',
        },
        componentsManifest: 'components.manifest.json',
        preview: {
          dir: 'preview',
          pages: [{ path: 'preview/overview.html', title: 'Overview' }],
        },
        assetsDir: 'assets',
        sourceFiles: {
          evidence: 'source/evidence.md',
          report: 'source/report.json',
        },
      }, null, 2)}\n`,
    );

    const response = await exportDesignSystemStaticHtml({
      designSystemId: 'acme',
      builtInRoot,
      userRoot,
      outDir: outRoot,
      includeSourceEvidence: true,
      now: new Date('2026-06-11T12:00:00.000Z'),
    });

    expect(response.export.files).toEqual(expect.arrayContaining([
      'index.html',
      'design-system.html',
      'tokens.html',
      'components.html',
      'examples.html',
      'data/design-system.json',
      'README.md',
      'assets/logo.svg',
      'preview/overview.html',
      'source-evidence.html',
      'quality-report.html',
    ]));
    const indexHtml = await readFile(response.export.entryFile, 'utf8');
    expect(indexHtml).not.toContain('/api/');
    expect(indexHtml).toContain('href="design-system.html"');
    expect(indexHtml).toContain('href="data/design-system.json"');
    expect(indexHtml).toContain('href="assets/logo.svg"');
    const data = await readFile(path.join(response.export.folder, 'data', 'design-system.json'), 'utf8');
    expect(data).toContain('"id": "acme"');
  });

  it('exports a DESIGN.md-only system without package-only pages', async () => {
    const systemDir = path.join(builtInRoot, 'legacy');
    await mkdir(systemDir, { recursive: true });
    await writeFile(path.join(systemDir, 'DESIGN.md'), '# Legacy\n\nLegacy guidance.\n');

    const response = await exportDesignSystemStaticHtml({
      designSystemId: 'legacy',
      builtInRoot,
      userRoot,
      outDir: outRoot,
      now: new Date('2026-06-11T12:00:00.000Z'),
    });

    expect(response.export.files).toEqual(expect.arrayContaining([
      'index.html',
      'design-system.html',
      'data/design-system.json',
      'README.md',
    ]));
    expect(response.export.files).not.toContain('tokens.html');
    expect(response.export.files).not.toContain('components.html');
  });

  it('exports generated user design systems with token, component, and preview fallbacks', async () => {
    const created = await createUserDesignSystem(userRoot, {
      title: 'Promoted Project System',
      summary: 'Source-backed review system.',
      body: '# Promoted Project System\n\n> Category: Product\n\nUse focused project review surfaces.\n',
      sourceNotes: 'Promoted from a Project with DESIGN.md and index.html.',
    });

    const response = await exportDesignSystemStaticHtml({
      designSystemId: created.id,
      builtInRoot,
      userRoot,
      outDir: outRoot,
      now: new Date('2026-06-11T12:00:00.000Z'),
    });

    expect(response.export.files).toEqual(expect.arrayContaining([
      'index.html',
      'design-system.html',
      'tokens.html',
      'components.html',
      'examples.html',
      'assets/logo.svg',
      'preview/colors-primary.html',
      'preview/components-buttons.html',
      'source-evidence.html',
    ]));
    const indexHtml = await readFile(response.export.entryFile, 'utf8');
    expect(indexHtml).toContain('href="tokens.html"');
    expect(indexHtml).toContain('href="components.html"');
    expect(indexHtml).toContain('href="examples.html"');
    expect(indexHtml).toContain('href="data/design-system.json"');
    expect(indexHtml).not.toContain('/api/');
    const componentsHtml = await readFile(path.join(response.export.folder, 'components.html'), 'utf8');
    expect(componentsHtml).toContain('preview/components-buttons.html');
  });

  it('reports a missing design system with a typed service error', async () => {
    await expect(exportDesignSystemStaticHtml({
      designSystemId: 'missing',
      builtInRoot,
      userRoot,
      outDir: outRoot,
    })).rejects.toMatchObject({
      code: 'DESIGN_SYSTEM_NOT_FOUND',
    });
  });

  it('creates a child export folder and refuses to overwrite an existing one', async () => {
    const systemDir = path.join(builtInRoot, 'acme');
    await mkdir(systemDir, { recursive: true });
    await writeFile(path.join(systemDir, 'DESIGN.md'), '# Acme\n\nAcme body.\n');
    const existing = path.join(outRoot, 'acme-static-html-2026-06-11T12-00-00-000Z');
    await mkdir(existing, { recursive: true });
    await writeFile(path.join(existing, 'sentinel.txt'), 'keep me');

    await expect(exportDesignSystemStaticHtml({
      designSystemId: 'acme',
      builtInRoot,
      userRoot,
      outDir: outRoot,
      now: new Date('2026-06-11T12:00:00.000Z'),
    })).rejects.toBeInstanceOf(DesignSystemStaticExportError);
    await expect(readFile(path.join(existing, 'sentinel.txt'), 'utf8')).resolves.toBe('keep me');
  });

  it('skips unsafe manifest paths instead of copying files outside the package root', async () => {
    const systemDir = path.join(builtInRoot, 'unsafe');
    await mkdir(systemDir, { recursive: true });
    await writeFile(path.join(systemDir, 'DESIGN.md'), '# Unsafe\n\nUnsafe body.\n');
    await writeFile(path.join(systemDir, 'tokens.css'), ':root { --safe: #fff; }\n');
    await writeFile(path.join(root, 'secret.txt'), 'do not copy');
    await writeFile(
      path.join(systemDir, 'manifest.json'),
      `${JSON.stringify({
        schemaVersion: 'od-design-system-project/v1',
        id: 'unsafe',
        name: 'Unsafe',
        category: 'Security',
        files: { design: 'DESIGN.md', tokens: 'tokens.css' },
        assetsDir: '../',
        sourceFiles: { report: '../secret.txt' },
      }, null, 2)}\n`,
    );

    const response = await exportDesignSystemStaticHtml({
      designSystemId: 'unsafe',
      builtInRoot,
      userRoot,
      outDir: outRoot,
      now: new Date('2026-06-11T12:00:00.000Z'),
    });

    expect(response.export.warnings).toEqual(expect.arrayContaining([
      'Skipped unsafe manifest path: ../secret.txt',
      'Skipped unsafe assetsDir: ../',
    ]));
    await expect(stat(path.join(response.export.folder, 'secret.txt'))).rejects.toThrow();
  });
});
