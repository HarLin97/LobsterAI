import { describe, expect, test } from 'vitest';

import {
  buildSessionDiagnosticsArchiveEntries,
  buildSessionDiagnosticsDefaultFileName,
  buildSessionDiagnosticsStats,
} from './archive';
import type { CoworkSessionDiagnosticsData } from './types';

const createDiagnosticsData = (): CoworkSessionDiagnosticsData => ({
  session: {
    id: 'session-1234567890',
    title: 'LOFTER <content> safety review',
    claude_session_id: 'openclaw-session',
    status: 'completed',
    pinned: 0,
    pin_order: null,
    cwd: 'D:\\workspace',
    system_prompt: 'system',
    model_override: '',
    execution_mode: 'local',
    parent_session_id: null,
    forked_from_message_id: null,
    forked_at: null,
    fork_mode: 'none',
    fork_workspace_path: null,
    fork_git_branch: null,
    fork_git_base_ref: null,
    goal_json: null,
    active_skill_ids: '[]',
    agent_id: 'main',
    created_at: 1,
    updated_at: 2,
  },
  messages: [
    {
      id: 'message-user',
      session_id: 'session-1234567890',
      type: 'user',
      content: 'Prompt',
      metadata: null,
      created_at: 1,
      sequence: 1,
    },
    {
      id: 'message-thinking',
      session_id: 'session-1234567890',
      type: 'assistant',
      content: 'thinking',
      metadata: '{"isThinking":true}',
      created_at: 2,
      sequence: 2,
    },
    {
      id: 'message-tool',
      session_id: 'session-1234567890',
      type: 'tool_result',
      content: 'tool output',
      metadata: '{"toolName":"read"}',
      created_at: 3,
      sequence: 3,
    },
  ],
  capsule: null,
  agent: {
    id: 'main',
    name: 'Prompt PE',
    model: 'test-model',
    source: 'custom',
    presetId: '',
    isDefault: true,
    enabled: true,
    createdAt: 1,
    updatedAt: 2,
  },
});

describe('sessionDiagnosticsArchive', () => {
  test('builds a stable diagnostics zip file name', () => {
    const fileName = buildSessionDiagnosticsDefaultFileName({
      title: 'LOFTER <>:"/\\|?* content safety review Prompt',
      sessionId: 'session-1234567890',
      now: new Date('2026-07-03T01:02:03Z'),
    });

    expect(fileName).toMatch(
      /^lobsterai-session-diagnostics-LOFTER content safety review Prompt-session--\d{8}-\d{6}\.zip$/,
    );
  });

  test('builds archive entries with raw JSONL messages and stats', () => {
    const data = createDiagnosticsData();
    const entries = buildSessionDiagnosticsArchiveEntries({
      data,
      appVersion: '1.2.3',
      exportedAt: '2026-07-03T00:00:00.000Z',
    });

    expect(entries.map((entry) => entry.archiveName)).toEqual([
      'manifest.json',
      'session.json',
      'messages.jsonl',
      'capsule.json',
      'agent.json',
      'stats.json',
    ]);

    const messages = entries.find((entry) => entry.archiveName === 'messages.jsonl')?.content.trim().split('\n');
    expect(messages).toHaveLength(3);
    expect(JSON.parse(messages?.[0] ?? '{}')).toMatchObject({
      id: 'message-user',
      session_id: 'session-1234567890',
      metadata: null,
    });

    const stats = buildSessionDiagnosticsStats(data);
    expect(stats).toMatchObject({
      totalMessages: 3,
      messagesByType: {
        user: 1,
        assistant: 1,
        tool_result: 1,
      },
      visibleRailMessages: 1,
      maxToolResultContentChars: 11,
    });
  });
});
