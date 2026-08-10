import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

import { i18nService } from '../../services/i18n';
import AgentTaskRow from './AgentTaskRow';
import { AgentSidebarIndicator } from './constants';
import type { AgentSidebarTaskNode } from './types';

const makeTask = (isScheduledTask: boolean): AgentSidebarTaskNode => ({
  id: isScheduledTask ? 'scheduled-session' : 'regular-session',
  agentId: 'main',
  title: isScheduledTask ? '[定时] Daily summary' : 'Regular task',
  isScheduledTask,
  status: 'completed',
  pinned: false,
  pinOrder: null,
  updatedAt: 200,
  createdAt: 100,
  indicator: AgentSidebarIndicator.None,
  isSelected: false,
});

const renderTask = (isScheduledTask: boolean) => renderToStaticMarkup(
  React.createElement(AgentTaskRow, {
    task: makeTask(isScheduledTask),
    isBatchMode: false,
    isSelected: false,
    onSelect: vi.fn(),
    onDelete: vi.fn(async () => {}),
    onShare: vi.fn(async () => {}),
    onTogglePin: vi.fn(async () => {}),
    onRename: vi.fn(async () => {}),
    onToggleSelection: vi.fn(),
    onEnterBatchMode: vi.fn(),
  }),
);

test('scheduled task rows show a localized accessible clock marker without marking regular rows', () => {
  const originalLanguage = i18nService.getLanguage();
  try {
    i18nService.setLanguage('zh', { persist: false });
    const zhScheduledHtml = renderTask(true);
    expect(zhScheduledHtml).toContain('aria-label="定时任务"');
    expect(zhScheduledHtml).toContain('title="定时任务"');
    expect(zhScheduledHtml).toContain('role="img"');
    expect(zhScheduledHtml).toMatch(/role="img"[^>]*>\s*<svg/);
    expect(zhScheduledHtml).toContain('Daily summary');
    expect(zhScheduledHtml).not.toContain('[定时]');

    i18nService.setLanguage('en', { persist: false });
    const enScheduledHtml = renderTask(true);
    expect(enScheduledHtml).toContain('aria-label="Scheduled task"');
    expect(enScheduledHtml).toContain('title="Scheduled task"');
    expect(renderTask(false)).not.toContain('aria-label="Scheduled task"');
  } finally {
    i18nService.setLanguage(originalLanguage, { persist: false });
  }
});
