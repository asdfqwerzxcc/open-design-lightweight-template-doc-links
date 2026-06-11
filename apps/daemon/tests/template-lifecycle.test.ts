import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  closeDatabase,
  deleteProject,
  deleteTemplate,
  getProject,
  getTemplate,
  insertProject,
  insertTemplate,
  openDatabase,
} from '../src/db.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-template-lifecycle-'));
});

afterEach(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('template lifecycle independence', () => {
  it('keeps templates after deleting their source Project', () => {
    const db = openDatabase(tempDir);
    insertProject(db, {
      id: 'source_project',
      name: 'Source Project',
      createdAt: 100,
      updatedAt: 100,
    });
    insertTemplate(db, {
      id: 'template_from_source',
      name: 'Template From Source',
      sourceProjectId: 'source_project',
      files: [{ name: 'index.html', content: '<main>Source</main>' }],
      createdAt: 110,
    });

    deleteProject(db, 'source_project');

    expect(getProject(db, 'source_project')).toBeNull();
    expect(getTemplate(db, 'template_from_source')).toMatchObject({
      id: 'template_from_source',
      sourceProjectId: 'source_project',
    });
  });

  it('keeps Projects created from a template after deleting the template', () => {
    const db = openDatabase(tempDir);
    insertTemplate(db, {
      id: 'template_for_project',
      name: 'Template For Project',
      sourceKind: 'html-import',
      files: [{ name: 'index.html', content: '<main>Template</main>', kind: 'html' }],
      htmlSource: '<main>Template</main>',
      createdAt: 120,
    });
    insertProject(db, {
      id: 'created_project',
      name: 'Created Project',
      metadata: { kind: 'template', templateId: 'template_for_project' },
      createdAt: 130,
      updatedAt: 130,
    });

    deleteTemplate(db, 'template_for_project');

    expect(getTemplate(db, 'template_for_project')).toBeNull();
    expect(getProject(db, 'created_project')).toMatchObject({
      id: 'created_project',
      metadata: { kind: 'template', templateId: 'template_for_project' },
    });
  });
});
