import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { closeDatabase, getTemplate, insertTemplate, listTemplates, openDatabase } from '../src/db.js';
import { deriveHtmlTemplateDesignSystem } from '../src/templates/html-template-derivation.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-template-html-'));
});

afterEach(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('template HTML import storage', () => {
  it('keeps legacy template rows readable after migration', () => {
    const dataDir = path.join(tempDir, '.od');
    mkdirSync(dataDir, { recursive: true });
    const legacyDb = new Database(path.join(dataDir, 'app.sqlite'));
    legacyDb.exec(`
      CREATE TABLE templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        source_project_id TEXT,
        files_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      INSERT INTO templates (id, name, description, source_project_id, files_json, created_at)
      VALUES ('tpl_legacy', 'Legacy', NULL, 'project_1', '[{"name":"index.html","content":"<main>Legacy</main>"}]', 10);
    `);
    legacyDb.close();

    const db = openDatabase(tempDir);
    const [template] = listTemplates(db);

    expect(template).toBeDefined();
    if (!template) throw new Error('expected migrated legacy template');
    expect(template).toMatchObject({
      id: 'tpl_legacy',
      name: 'Legacy',
      sourceProjectId: 'project_1',
      sourceKind: 'project-snapshot',
      derivationStatus: 'complete',
      updatedAt: 10,
    });
    expect(template.files).toEqual([{ name: 'index.html', content: '<main>Legacy</main>' }]);
    expect(template.htmlSource).toBeUndefined();
    expect(template.designSystem).toBeUndefined();
  });

  it('stores html import template metadata and derived design system fields', () => {
    const db = openDatabase(tempDir);
    const html = `
      <html>
        <head><title>Launch Card</title><style>:root { --brand: #3366ff; } .cta { color: rgb(20, 40, 60); }</style></head>
        <body><h1>Fallback title</h1><button class="cta">Start</button></body>
      </html>
    `;
    const designSystem = deriveHtmlTemplateDesignSystem({ html, name: 'Imported' });

    insertTemplate(db, {
      id: 'tpl_html',
      name: 'Imported',
      sourceKind: 'html-import',
      files: [{ name: 'index.html', content: html, kind: 'html' }],
      htmlSource: html,
      designSystem,
      derivationStatus: 'partial',
      derivationWarnings: ['components require review'],
      createdAt: 20,
      updatedAt: 21,
    });

    const template = getTemplate(db, 'tpl_html');

    expect(template?.sourceKind).toBe('html-import');
    expect(template?.htmlSource).toContain('<button class="cta">Start</button>');
    expect(template?.designSystem?.manifest).toMatchObject({
      schemaVersion: 'od-design-system-project/v1',
      name: 'Launch Card',
    });
    expect(template?.designSystem?.tokensCss).toContain('--color-1: #3366ff;');
    expect(template?.designSystem?.extractedColors).toEqual(['#3366ff', 'rgb(20, 40, 60)']);
    expect(template?.derivationStatus).toBe('partial');
    expect(template?.derivationWarnings).toEqual(['components require review']);
    expect(template?.updatedAt).toBe(21);
  });
});
