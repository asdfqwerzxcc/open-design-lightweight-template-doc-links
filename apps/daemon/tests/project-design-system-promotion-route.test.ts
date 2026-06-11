import express from 'express';
import type http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Project } from '@open-design/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerProjectDesignSystemPromotionRoutes } from '../src/routes/project-design-system-promotion.js';

describe('project design system promotion route', () => {
  let server: http.Server;
  let baseUrl: string;
  let tempRoot: string;
  let projectsRoot: string;
  let userDesignSystemsRoot: string;
  let projects: Map<string, Project>;

  beforeEach(async () => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'od-project-ds-promotion-route-'));
    projectsRoot = path.join(tempRoot, 'projects');
    userDesignSystemsRoot = path.join(tempRoot, 'user-design-systems');
    projects = new Map();
    await mkdir(projectsRoot, { recursive: true });
    await mkdir(userDesignSystemsRoot, { recursive: true });

    const app = express();
    app.use(express.json({ limit: '4mb' }));
    registerProjectDesignSystemPromotionRoutes(app, {
      paths: {
        PROJECTS_DIR: projectsRoot,
        USER_DESIGN_SYSTEMS_DIR: userDesignSystemsRoot,
      },
      getProject: (projectId) => projects.get(projectId) ?? null,
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

  async function addProject(id: string, name: string): Promise<Project> {
    const project: Project = {
      id,
      name,
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
    };
    projects.set(id, project);
    await mkdir(path.join(projectsRoot, id), { recursive: true });
    return project;
  }

  async function writeProjectText(projectId: string, filePath: string, content: string): Promise<void> {
    const target = path.join(projectsRoot, projectId, filePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }

  it('promotes a project DESIGN.md into an editable user design system', async () => {
    await addProject('project-with-design', 'Project With Design');
    await writeProjectText(
      'project-with-design',
      'DESIGN.md',
      '# Existing System\n\nUse source-backed project rules.\n',
    );
    await writeProjectText('project-with-design', 'index.html', '<main>Preview</main>');
    const sourceBefore = await readFile(path.join(projectsRoot, 'project-with-design', 'DESIGN.md'), 'utf8');

    const resp = await fetch(`${baseUrl}/api/projects/project-with-design/design-system-promotions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Promoted Project System' }),
    });

    expect(resp.status).toBe(201);
    const body = await resp.json() as {
      designSystem: { id: string; body: string; isEditable: boolean };
      projectId: string;
      sourceFiles: string[];
      warnings: string[];
    };
    expect(body.projectId).toBe('project-with-design');
    expect(body.designSystem.id.startsWith('user:')).toBe(true);
    expect(body.designSystem.isEditable).toBe(true);
    expect(body.designSystem.body).toContain('Use source-backed project rules.');
    expect(body.sourceFiles).toContain('DESIGN.md');
    expect(body.warnings).toEqual([]);
    await expect(readFile(path.join(projectsRoot, 'project-with-design', 'DESIGN.md'), 'utf8'))
      .resolves.toBe(sourceBefore);
  });

  it('creates a review-required candidate when the project has no DESIGN.md', async () => {
    await addProject('project-without-design', 'Project Without Design');
    await writeProjectText('project-without-design', 'index.html', '<main>Preview</main>');
    await writeProjectText('project-without-design', 'src/theme.css', ':root { color-scheme: light; }');

    const resp = await fetch(`${baseUrl}/api/projects/project-without-design/design-system-promotions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(resp.status).toBe(201);
    const body = await resp.json() as {
      designSystem: { id: string; body: string };
      sourceFiles: string[];
      warnings: string[];
    };
    expect(body.designSystem.id.startsWith('user:')).toBe(true);
    expect(body.designSystem.body).toContain('Review required');
    expect(body.designSystem.body).toContain('Project Without Design');
    expect(body.designSystem.body).toContain('index.html');
    expect(body.designSystem.body).toContain('src/theme.css');
    expect(body.sourceFiles).toEqual(expect.arrayContaining(['index.html', 'src/theme.css']));
    expect(body.warnings.join('\n')).toMatch(/DESIGN\.md was not found/i);
  });

  it('returns 404 for a missing project', async () => {
    const resp = await fetch(`${baseUrl}/api/projects/missing-project/design-system-promotions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(resp.status).toBe(404);
    await expect(resp.json()).resolves.toMatchObject({ error: expect.stringMatching(/project not found/i) });
  });
});
