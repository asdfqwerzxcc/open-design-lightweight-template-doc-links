// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectView } from '../../src/components/ProjectView';
import { navigate } from '../../src/router';
import type {
  AgentInfo,
  AppConfig,
  Conversation,
  DesignSystemSummary,
  Project,
  SkillSummary,
} from '../../src/types';
import {
  createConversation,
  listConversations,
  listMessages,
} from '../../src/state/projects';
import {
  fetchPreviewComments,
  promoteProjectToDesignSystem,
} from '../../src/providers/registry';

const testTranslations: Record<string, string> = {
  'designSystemPicker.createDraftAria': 'Create design system draft',
  'designSystemPicker.createDraftBusyAria': 'Creating design system draft',
  'designSystemPicker.createDraftBusy': 'Creating',
  'designSystemPicker.createDraftLabel': 'Create system',
  'designSystemPicker.createDraftTitle': 'Create a design system draft from this Project',
};

vi.mock('../../src/i18n', () => ({
  useI18n: () => ({
    locale: 'en',
    setLocale: () => undefined,
    t: (key: string) => testTranslations[key] ?? key,
  }),
  useT: () => (key: string) => testTranslations[key] ?? key,
}));

vi.mock('../../src/router', () => ({
  navigate: vi.fn(),
}));

vi.mock('../../src/providers/anthropic', () => ({
  streamMessage: vi.fn(),
}));

vi.mock('../../src/providers/daemon', () => ({
  fetchChatRunStatus: vi.fn(),
  fetchVelaLoginStatus: vi.fn(),
  listActiveChatRuns: vi.fn().mockResolvedValue([]),
  listProjectRuns: vi.fn().mockResolvedValue([]),
  reattachDaemonRun: vi.fn(),
  reportChatRunFeedback: vi.fn(),
  streamViaDaemon: vi.fn(),
}));

vi.mock('../../src/providers/project-events', () => ({
  useProjectFileEvents: vi.fn(),
}));

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    deletePreviewComment: vi.fn(),
    fetchConnectorStatuses: vi.fn().mockResolvedValue([]),
    fetchDesignSystem: vi.fn(),
    fetchDesignTemplate: vi.fn(),
    fetchLiveArtifacts: vi.fn().mockResolvedValue([]),
    fetchPreviewComments: vi.fn(),
    fetchProjectDesignSystemPackageAudit: vi.fn(),
    fetchProjectFiles: vi.fn().mockResolvedValue([]),
    fetchSkill: vi.fn(),
    patchPreviewCommentStatus: vi.fn(),
    promoteProjectToDesignSystem: vi.fn(),
    upsertPreviewComment: vi.fn(),
    writeProjectTextFile: vi.fn(),
  };
});

vi.mock('../../src/state/projects', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/projects')>(
    '../../src/state/projects',
  );
  return {
    ...actual,
    createConversation: vi.fn(),
    listConversations: vi.fn(),
    listMessages: vi.fn(),
    loadTabs: vi.fn().mockResolvedValue({ tabs: [], active: null }),
    patchConversation: vi.fn(),
    patchProject: vi.fn(),
    saveMessage: vi.fn(),
    saveTabs: vi.fn(),
  };
});

vi.mock('../../src/components/AppChromeHeader', () => ({
  AppChromeHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));

vi.mock('../../src/components/AvatarMenu', () => ({
  AvatarMenu: () => null,
}));

vi.mock('../../src/components/FileWorkspace', () => ({
  FileWorkspace: () => <div data-testid="file-workspace" />,
}));

vi.mock('../../src/components/Loading', () => ({
  CenteredLoader: () => <div data-testid="loader" />,
}));

vi.mock('../../src/components/ChatPane', () => ({
  ChatPane: ({ designSystemPicker }: { designSystemPicker?: ReactNode }) => (
    <div data-testid="chat-pane">{designSystemPicker}</div>
  ),
}));

const mockedListConversations = vi.mocked(listConversations);
const mockedCreateConversation = vi.mocked(createConversation);
const mockedListMessages = vi.mocked(listMessages);
const mockedFetchPreviewComments = vi.mocked(fetchPreviewComments);
const mockedPromoteProjectToDesignSystem = vi.mocked(promoteProjectToDesignSystem);
const mockedNavigate = vi.mocked(navigate);

const config: AppConfig = {
  mode: 'api',
  apiKey: '',
  baseUrl: '',
  model: '',
  agentId: null,
  skillId: null,
  designSystemId: null,
};

const project: Project = {
  id: 'project-1',
  name: 'Project One',
  skillId: null,
  designSystemId: null,
  createdAt: 1,
  updatedAt: 1,
};

const conversation: Conversation = {
  id: 'conv-1',
  projectId: project.id,
  title: null,
  createdAt: 1,
  updatedAt: 1,
};

function renderProjectView(onDesignSystemsRefresh = vi.fn()) {
  return render(
    <ProjectView
      project={project}
      routeFileName={null}
      config={config}
      agents={[] as AgentInfo[]}
      skills={[] as SkillSummary[]}
      designTemplates={[] as SkillSummary[]}
      designSystems={[] as DesignSystemSummary[]}
      daemonLive
      onModeChange={vi.fn()}
      onAgentChange={vi.fn()}
      onAgentModelChange={vi.fn()}
      onRefreshAgents={vi.fn()}
      onOpenSettings={vi.fn()}
      onBack={vi.fn()}
      onClearPendingPrompt={vi.fn()}
      onTouchProject={vi.fn()}
      onProjectChange={vi.fn()}
      onProjectsRefresh={vi.fn()}
      onDesignSystemsRefresh={onDesignSystemsRefresh}
    />,
  );
}

describe('ProjectView promote to design system action', () => {
  beforeEach(() => {
    mockedListConversations.mockResolvedValue([conversation]);
    mockedCreateConversation.mockResolvedValue(conversation);
    mockedListMessages.mockResolvedValue([]);
    mockedFetchPreviewComments.mockResolvedValue([]);
    mockedPromoteProjectToDesignSystem.mockResolvedValue({
      designSystem: {
        id: 'user:project-one',
        title: 'Project One Design System',
        category: 'Project Candidate',
        summary: 'Promoted from project.',
        body: '# Project One Design System\n',
      },
      projectId: project.id,
      sourceFiles: ['DESIGN.md'],
      warnings: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('promotes through the provider, refreshes systems, and navigates to the new detail route', async () => {
    const onDesignSystemsRefresh = vi.fn();
    renderProjectView(onDesignSystemsRefresh);
    const button = await screen.findByRole('button', { name: /Create design system draft/i });
    mockedNavigate.mockClear();

    fireEvent.click(button);

    await waitFor(() => {
      expect(mockedPromoteProjectToDesignSystem).toHaveBeenCalledWith('project-1', {
        title: 'Project One Design System',
      });
    });
    expect(onDesignSystemsRefresh).toHaveBeenCalledTimes(1);
    expect(mockedNavigate).toHaveBeenCalledWith({
      kind: 'design-system-detail',
      designSystemId: 'user:project-one',
    });
  });

  it('shows an error and stays on the project route when promotion fails', async () => {
    mockedPromoteProjectToDesignSystem.mockResolvedValue(null);
    renderProjectView();
    const button = await screen.findByRole('button', { name: /Create design system draft/i });
    mockedNavigate.mockClear();

    fireEvent.click(button);

    expect(await screen.findByText('Could not promote project to design system')).toBeTruthy();
    expect(mockedNavigate).not.toHaveBeenCalled();
  });
});
