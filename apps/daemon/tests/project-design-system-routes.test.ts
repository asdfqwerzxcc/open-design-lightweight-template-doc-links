import type http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

describe('project design system route gates', () => {
  let server: http.Server | null = null;
  let baseUrl: string;
  const projectsToClean: string[] = [];
  const designSystemsToClean: string[] = [];
  const tempDirs: string[] = [];

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  }, 30_000);

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    for (const id of projectsToClean.splice(0)) {
      await fetch(`${baseUrl}/api/projects/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }).catch(() => {});
    }
    for (const id of designSystemsToClean.splice(0)) {
      await fetch(`${baseUrl}/api/design-systems/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }).catch(() => {});
    }
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  }, 30_000);

  function uniqueId(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  }

  async function createUserDesignSystem(status: 'draft' | 'published') {
    const resp = await fetch(`${baseUrl}/api/design-systems`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `Route Gate ${uniqueId(status)}`,
        summary: 'Route-level design system usage guard.',
        status,
      }),
    });
    expect(resp.status).toBe(201);
    const body = (await resp.json()) as {
      designSystem: { id: string; status: string };
    };
    designSystemsToClean.push(body.designSystem.id);
    return body.designSystem;
  }

  async function createProject(body: Record<string, unknown>) {
    return fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function writeProjectText(projectId: string, name: string, content: string) {
    const resp = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content }),
    });
    expect(resp.status).toBe(200);
  }

  async function readProjectText(projectId: string, name: string) {
    const resp = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}/files/${name}`);
    expect(resp.status).toBe(200);
    return resp.text();
  }

  it('rejects draft design systems when creating a project', async () => {
    const draft = await createUserDesignSystem('draft');
    const id = uniqueId('project-draft-ds');

    const resp = await createProject({
      id,
      name: 'Draft Design System Project',
      designSystemId: draft.id,
    });

    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error?: { message?: string } };
    expect(body.error?.message).toMatch(/draft design systems cannot be used/i);
  });

  it('allows published design systems when creating a project', async () => {
    const published = await createUserDesignSystem('published');
    const id = uniqueId('project-published-ds');

    const resp = await createProject({
      id,
      name: 'Published Design System Project',
      designSystemId: published.id,
    });

    expect(resp.status).toBe(200);
    projectsToClean.push(id);
    const body = (await resp.json()) as {
      project: { id: string; designSystemId: string | null };
    };
    expect(body.project.designSystemId).toBe(published.id);
  });

  it('preserves a pending first agent task when a design-system workspace is re-opened', async () => {
    const draft = await createUserDesignSystem('draft');

    const workspaceResp = await fetch(
      `${baseUrl}/api/design-systems/${encodeURIComponent(draft.id)}/workspace`,
      { method: 'POST' },
    );
    expect(workspaceResp.status).toBe(201);
    const workspaceBody = (await workspaceResp.json()) as {
      project: { id: string; pendingPrompt?: string | null };
    };
    const projectId = workspaceBody.project.id;
    projectsToClean.push(projectId);

    const prompt =
      'Create this project as a complete Open Design design system workspace.';
    const patchResp = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pendingPrompt: prompt }),
    });
    expect(patchResp.status).toBe(200);

    const reopenedResp = await fetch(
      `${baseUrl}/api/design-systems/${encodeURIComponent(draft.id)}/workspace`,
      { method: 'POST' },
    );
    expect(reopenedResp.status).toBe(201);
    const reopenedBody = (await reopenedResp.json()) as {
      project: { id: string; pendingPrompt?: string | null };
    };

    expect(reopenedBody.project.id).toBe(projectId);
    expect(reopenedBody.project.pendingPrompt).toBe(prompt);
  });

  it('audits generated design-system package files from the project workspace', async () => {
    const projectId = uniqueId('project-ds-audit');
    const createResp = await createProject({
      id: projectId,
      name: 'Package Audit Project',
      skillId: null,
      designSystemId: null,
    });
    expect(createResp.status).toBe(200);
    projectsToClean.push(projectId);

    await writeProjectText(projectId, 'DESIGN.md', '# Package Audit Project\n\nOnly the rules file exists so far.\n');

    const auditResp = await fetch(
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/design-system-package-audit`,
    );
    expect(auditResp.status).toBe(200);
    const body = (await auditResp.json()) as {
      audit: {
        ok: boolean;
        filesInspected: number;
        errors: Array<{ code: string; path?: string }>;
      };
    };

    expect(body.audit.ok).toBe(false);
    expect(body.audit.filesInspected).toBeGreaterThan(0);
    expect(body.audit.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing_required_file', path: 'README.md' }),
        expect.objectContaining({ code: 'missing_required_file', path: 'SKILL.md' }),
      ]),
    );
  });

  it('removes legacy design-system artifact names when re-opening a migrated workspace', async () => {
    const draft = await createUserDesignSystem('draft');

    const workspaceResp = await fetch(
      `${baseUrl}/api/design-systems/${encodeURIComponent(draft.id)}/workspace`,
      { method: 'POST' },
    );
    expect(workspaceResp.status).toBe(201);
    const workspaceBody = (await workspaceResp.json()) as {
      project: { id: string };
    };
    const projectId = workspaceBody.project.id;
    projectsToClean.push(projectId);

    await writeProjectText(
      projectId,
      'preview/typography-scale.html',
      '<!doctype html><html><body>old type</body></html>',
    );
    await writeProjectText(
      projectId,
      'preview/colors-ui-palette.html',
      '<!doctype html><html><body>old colors</body></html>',
    );
    await writeProjectText(
      projectId,
      'ui_kits/generated_interface/index.html',
      '<!doctype html><html><body>old app</body></html>',
    );

    const reopenedResp = await fetch(
      `${baseUrl}/api/design-systems/${encodeURIComponent(draft.id)}/workspace`,
      { method: 'POST' },
    );
    expect(reopenedResp.status).toBe(201);
    const reopenedBody = (await reopenedResp.json()) as {
      files: Array<{ path: string }>;
    };
    const paths = reopenedBody.files.map((file) => file.path);

    expect(paths).toEqual(expect.arrayContaining([
      'preview/typography-specimens.html',
      'preview/colors-primary.html',
      'ui_kits/app/index.html',
    ]));
    expect(paths).not.toEqual(expect.arrayContaining([
      'preview/typography-scale.html',
      'preview/colors-ui-palette.html',
      'ui_kits/generated_interface/index.html',
    ]));
  });

  it('refreshes stale design-system workspace docs that still point at legacy package paths', async () => {
    const draft = await createUserDesignSystem('draft');

    const workspaceResp = await fetch(
      `${baseUrl}/api/design-systems/${encodeURIComponent(draft.id)}/workspace`,
      { method: 'POST' },
    );
    expect(workspaceResp.status).toBe(201);
    const workspaceBody = (await workspaceResp.json()) as {
      project: { id: string };
    };
    const projectId = workspaceBody.project.id;
    projectsToClean.push(projectId);

    await writeProjectText(
      projectId,
      'README.md',
      '# Stale README\n\nReview preview/typography-scale.html and ui_kits/generated_interface/index.html.\n',
    );
    await writeProjectText(
      projectId,
      'SKILL.md',
      '# Stale Skill\n\nUse preview/colors-ui-palette.html and ui_kits/generated_interface/.\n',
    );

    const reopenedResp = await fetch(
      `${baseUrl}/api/design-systems/${encodeURIComponent(draft.id)}/workspace`,
      { method: 'POST' },
    );
    expect(reopenedResp.status).toBe(201);

    const readme = await readProjectText(projectId, 'README.md');
    const skill = await readProjectText(projectId, 'SKILL.md');
    expect(readme).toContain('preview/');
    expect(readme).not.toContain('ui_kits/generated_interface');
    expect(readme).not.toContain('preview/typography-scale.html');
    expect(skill).not.toContain('ui_kits/generated_interface');
    expect(skill).not.toContain('preview/colors-ui-palette.html');
  });

  it('rejects patching an existing project to a draft design system', async () => {
    const draft = await createUserDesignSystem('draft');
    const id = uniqueId('project-patch-draft-ds');
    const createResp = await createProject({ id, name: 'Patch Guard Project' });
    expect(createResp.status).toBe(200);
    projectsToClean.push(id);

    const resp = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ designSystemId: draft.id }),
    });

    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error?: { message?: string } };
    expect(body.error?.message).toMatch(/draft design systems cannot be used/i);
  });

  it('rejects draft design systems when importing a folder as a project', async () => {
    const draft = await createUserDesignSystem('draft');
    const folder = mkdtempSync(path.join(tmpdir(), 'od-import-draft-ds-'));
    tempDirs.push(folder);
    await writeFile(path.join(folder, 'index.html'), '<!doctype html>');

    const resp = await fetch(`${baseUrl}/api/import/folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseDir: folder,
        name: 'Imported Draft Design System Project',
        designSystemId: draft.id,
      }),
    });

    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error?: { message?: string } };
    expect(body.error?.message).toMatch(/draft design systems cannot be used/i);
  });
  it('filters general design-system catalog to approved systems', async () => {
    const draft = await createUserDesignSystem('draft');
    const published = await createUserDesignSystem('published');

    const resp = await fetch(`${baseUrl}/api/design-systems?visibility=approved`);

    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { designSystems: Array<{ id: string }> };
    const ids = body.designSystems.map((system) => system.id);
    expect(ids).toContain(published.id);
    expect(ids).not.toContain(draft.id);
  });

  it('creates a request-backed temporary project atomically', async () => {
    const id = uniqueId('project-ds-request');

    const resp = await createProject({
      id,
      name: 'Request Backed Project',
      designSystemId: null,
      metadata: { kind: 'prototype' },
      designSystemRequest: {
        source: 'home_new_project',
        reason: 'No approved brand system matches the internal tool.',
        temporaryMode: true,
      },
    });

    expect(resp.status).toBe(200);
    projectsToClean.push(id);
    const body = (await resp.json()) as {
      project: {
        designSystemId: string | null;
        metadata?: {
          designSystemMode?: string;
          designSystemRequest?: { id: string; status: string; reason: string };
        };
      };
    };
    expect(body.project.designSystemId).toBeNull();
    expect(body.project.metadata?.designSystemMode).toBe('temporary-none');
    expect(body.project.metadata?.designSystemRequest?.status).toBe('open');

    const requestResp = await fetch(
      `${baseUrl}/api/design-system-requests/${encodeURIComponent(body.project.metadata!.designSystemRequest!.id)}`,
    );
    expect(requestResp.status).toBe(200);
    const requestBody = (await requestResp.json()) as { request: { linkedProjectId?: string | null } };
    expect(requestBody.request.linkedProjectId).toBe(id);
  });

  it('links a no-fit request to an existing project atomically', async () => {
    const id = uniqueId('project-ds-existing-request');
    const createResp = await createProject({
      id,
      name: 'Existing Request Project',
      designSystemId: null,
      metadata: { kind: 'prototype' },
    });
    expect(createResp.status).toBe(200);
    projectsToClean.push(id);

    const resp = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(id)}/design-system-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Need a specific enterprise brand.', source: 'project_header' }),
    });

    expect(resp.status).toBe(201);
    const body = (await resp.json()) as {
      project: {
        id: string;
        designSystemId: string | null;
        metadata?: { designSystemMode?: string; designSystemRequest?: { id: string; status: string; reason: string } };
      };
      request: { id: string; linkedProjectId?: string | null; projectContext?: { projectName?: string } };
    };
    expect(body.project.designSystemId).toBeNull();
    expect(body.project.metadata?.designSystemMode).toBe('temporary-none');
    expect(body.project.metadata?.designSystemRequest?.id).toBe(body.request.id);
    expect(body.request.linkedProjectId).toBe(id);
    expect(body.request.projectContext?.projectName).toBe('Existing Request Project');
  });

  it('blocks publishing until readiness review gates pass', async () => {
    const draft = await createUserDesignSystem('draft');

    const blocked = await fetch(`${baseUrl}/api/design-systems/${encodeURIComponent(draft.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'published' }),
    });

    expect(blocked.status).toBe(400);
    const blockedBody = (await blocked.json()) as { error?: { code?: string } };
    expect(blockedBody.error?.code).toBe('DESIGN_SYSTEM_PUBLISH_BLOCKED');

    for (const gateId of [
      'review:designops',
      'review:brand-fit',
      'review:token-completeness',
      'review:component-completeness',
      'review:accessibility-baseline',
    ]) {
      const gateResp = await fetch(`${baseUrl}/api/design-systems/${encodeURIComponent(draft.id)}/readiness`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gateId, status: 'passed', actor: 'test' }),
      });
      expect(gateResp.status).toBe(200);
    }

    const published = await fetch(`${baseUrl}/api/design-systems/${encodeURIComponent(draft.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'published' }),
    });

    expect(published.status).toBe(200);
    const body = (await published.json()) as { designSystem: { status: string } };
    expect(body.designSystem.status).toBe('published');
  });

});
