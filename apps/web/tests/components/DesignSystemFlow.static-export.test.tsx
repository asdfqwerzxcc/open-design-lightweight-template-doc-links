// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesignSystemDetailView } from '../../src/components/DesignSystemFlow';
import type { AppConfig, Conversation, DesignSystemDetail, Project } from '../../src/types';

const mocks = vi.hoisted(() => ({
  createConversation: vi.fn(),
  ensureDesignSystemWorkspace: vi.fn(),
  exportDesignSystemStaticHtml: vi.fn(),
  fetchDesignSystem: vi.fn(),
  fetchDesignSystemRevisions: vi.fn(),
  listConversations: vi.fn(),
  listMessages: vi.fn(),
  loadTabs: vi.fn(),
  streamViaDaemon: vi.fn(),
}));

vi.mock('../../src/components/ChatPane', () => ({
  ChatPane: () => <div data-testid="design-system-chat" />,
}));

vi.mock('../../src/components/FileWorkspace', () => ({
  FileWorkspace: () => <div data-testid="design-system-files" />,
}));

vi.mock('../../src/providers/daemon', () => ({
  streamViaDaemon: (...args: unknown[]) => mocks.streamViaDaemon(...args),
}));

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    ensureDesignSystemWorkspace: mocks.ensureDesignSystemWorkspace,
    exportDesignSystemStaticHtml: mocks.exportDesignSystemStaticHtml,
    fetchDesignSystem: mocks.fetchDesignSystem,
    fetchDesignSystemRevisions: mocks.fetchDesignSystemRevisions,
  };
});

vi.mock('../../src/state/projects', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/projects')>(
    '../../src/state/projects',
  );
  return {
    ...actual,
    createConversation: mocks.createConversation,
    listConversations: mocks.listConversations,
    listMessages: mocks.listMessages,
    loadTabs: mocks.loadTabs,
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mocks.exportDesignSystemStaticHtml.mockResolvedValue(null);
  mocks.fetchDesignSystemRevisions.mockResolvedValue([]);
  mocks.listConversations.mockResolvedValue([]);
  mocks.listMessages.mockResolvedValue([]);
  mocks.loadTabs.mockResolvedValue({ tabs: [], active: null });
  mocks.createConversation.mockResolvedValue(null);
});

function renderDetailView(system: DesignSystemDetail) {
  const project: Project = {
    id: 'ds-acme-design-system',
    name: 'Acme Design System',
    skillId: null,
    designSystemId: system.id,
    createdAt: 1,
    updatedAt: 1,
    metadata: {
      kind: 'other',
      importedFrom: 'design-system',
      entryFile: 'DESIGN.md',
      sourceFileName: system.id,
    },
  };
  const config: AppConfig = {
    mode: 'daemon',
    apiKey: '',
    baseUrl: '',
    model: '',
    agentId: 'agent-1',
    agentModels: {},
    skillId: null,
    designSystemId: null,
  };
  const conversation: Conversation = {
    id: 'conv-design-system',
    projectId: project.id,
    title: 'Design system',
    createdAt: 1,
    updatedAt: 1,
  };

  mocks.fetchDesignSystem.mockResolvedValue(system);
  mocks.ensureDesignSystemWorkspace.mockResolvedValue({ project, files: [] });
  mocks.listConversations.mockResolvedValue([conversation]);

  render(
    <DesignSystemDetailView
      id={system.id}
      selectedId={system.id}
      config={config}
      agents={[{ id: 'agent-1', name: 'OpenCode', bin: 'opencode', available: true, models: [] }]}
      onBack={() => {}}
      onSetDefault={() => {}}
    />,
  );
}

function designSystemFixture(): DesignSystemDetail {
  return {
    id: 'user:acme-design-system',
    title: 'Acme Design System',
    category: 'Custom',
    summary: 'Acme product workspace.',
    swatches: [],
    surface: 'web',
    body: '# Acme Design System\n',
    source: 'user',
    status: 'draft',
    isEditable: true,
    projectId: 'ds-acme-design-system',
  };
}

describe('DesignSystemDetailView static export action', () => {
  it('exports a static HTML package and displays the returned paths', async () => {
    const system = designSystemFixture();
    mocks.exportDesignSystemStaticHtml.mockResolvedValue({
      export: {
        designSystemId: system.id,
        folder: '/tmp/acme-static-html',
        entryFile: '/tmp/acme-static-html/index.html',
        files: ['index.html'],
        warnings: [],
      },
    });

    renderDetailView(system);

    fireEvent.click(await screen.findByRole('button', { name: 'Export HTML package' }));

    await waitFor(() => expect(mocks.exportDesignSystemStaticHtml).toHaveBeenCalledWith(system.id));
    expect(mocks.exportDesignSystemStaticHtml).toHaveBeenCalledTimes(1);
    await screen.findByText('HTML package exported');
    expect(document.body.textContent).toContain('/tmp/acme-static-html');
    expect(document.body.textContent).toContain('/tmp/acme-static-html/index.html');
    const editor = screen.getByLabelText('DESIGN.md') as HTMLTextAreaElement;
    expect(editor.value).toBe('# Acme Design System\n');
  });

  it('shows a status-line error and re-enables the export button on failure', async () => {
    const system = designSystemFixture();
    mocks.exportDesignSystemStaticHtml.mockResolvedValue(null);

    renderDetailView(system);

    const button = await screen.findByRole<HTMLButtonElement>('button', { name: 'Export HTML package' });
    fireEvent.click(button);

    await waitFor(() => expect(mocks.exportDesignSystemStaticHtml).toHaveBeenCalledTimes(1));
    await screen.findByText('Could not export HTML package');
    await waitFor(() => expect(button.disabled).toBe(false));
  });
});
