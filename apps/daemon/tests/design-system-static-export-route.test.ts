import express from 'express';
import type http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerDesignSystemStaticExportRoutes } from '../src/routes/design-system-static-export.js';

describe('design system static HTML export route', () => {
  let server: http.Server;
  let baseUrl: string;
  let tempRoot: string;
  let designSystemsDir: string;
  let userDesignSystemsDir: string;
  let runtimeDataDir: string;

  beforeEach(async () => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'od-static-export-route-'));
    designSystemsDir = path.join(tempRoot, 'design-systems');
    userDesignSystemsDir = path.join(tempRoot, 'user-design-systems');
    runtimeDataDir = path.join(tempRoot, 'data');
    await mkdir(designSystemsDir, { recursive: true });
    await mkdir(userDesignSystemsDir, { recursive: true });
    await mkdir(runtimeDataDir, { recursive: true });

    const app = express();
    app.use(express.json({ limit: '4mb' }));
    registerDesignSystemStaticExportRoutes(app, {
      paths: {
        DESIGN_SYSTEMS_DIR: designSystemsDir,
        RUNTIME_DATA_DIR: runtimeDataDir,
        USER_DESIGN_SYSTEMS_DIR: userDesignSystemsDir,
      },
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    if (typeof address !== 'object' || address === null) throw new Error('server did not bind to a port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(tempRoot, { recursive: true, force: true });
  });

  async function writeDesignSystem(id: string): Promise<void> {
    const systemDir = path.join(designSystemsDir, id);
    await mkdir(systemDir, { recursive: true });
    await writeFile(path.join(systemDir, 'DESIGN.md'), `# ${id}\n\nRoute export body.\n`);
  }

  it('exports a static package and returns the entry file', async () => {
    await writeDesignSystem('route-system');
    const outDir = path.join(tempRoot, 'exports');

    const resp = await fetch(`${baseUrl}/api/design-systems/route-system/exports/static-html`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outDir }),
    });

    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      export: {
        designSystemId: string;
        folder: string;
        entryFile: string;
        files: string[];
        warnings: string[];
      };
    };
    expect(body.export.designSystemId).toBe('route-system');
    expect(body.export.entryFile.endsWith('index.html')).toBe(true);
    expect(body.export.files).toContain('index.html');
    const entryStats = await stat(body.export.entryFile);
    expect(entryStats.isFile()).toBe(true);
    await expect(readFile(body.export.entryFile, 'utf8')).resolves.not.toContain('/api/');
  });

  it('returns 404 for a missing design system id', async () => {
    const resp = await fetch(`${baseUrl}/api/design-systems/missing-static-export/exports/static-html`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(resp.status).toBe(404);
    await expect(resp.json()).resolves.toMatchObject({ error: expect.stringMatching(/not found/i) });
  });

  it('returns 400 for an invalid output path input', async () => {
    await writeDesignSystem('route-system');

    const resp = await fetch(`${baseUrl}/api/design-systems/route-system/exports/static-html`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outDir: 123 }),
    });

    expect(resp.status).toBe(400);
    await expect(resp.json()).resolves.toMatchObject({ error: expect.stringMatching(/outDir/i) });
  });

  it('returns 400 when the selected output path is not a directory', async () => {
    await writeDesignSystem('route-system');
    const outFile = path.join(tempRoot, 'not-a-directory');
    writeFileSync(outFile, 'file');

    const resp = await fetch(`${baseUrl}/api/design-systems/route-system/exports/static-html`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outDir: outFile }),
    });

    expect(resp.status).toBe(400);
    await expect(resp.json()).resolves.toMatchObject({ error: expect.stringMatching(/output path/i) });
  });
});
