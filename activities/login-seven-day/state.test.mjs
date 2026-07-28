import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ActivityLifecycle,
  buildDayItems,
  buildIdempotencyKey,
  normalizeActivityContext,
  resolvePrimaryAction,
  resolveTerminalCopy,
} from './state.mjs';

test('normalizes the server context and exposes the check-in action', () => {
  const state = normalizeActivityContext({
    lifecycleState: ActivityLifecycle.Active,
    authenticated: true,
    loginRequired: true,
    serverTime: '2026-07-28T04:00:00Z',
    state: {
      totalDays: 7,
      claimedDays: 2,
      claimedToday: false,
      rewardCredits: 10,
      timezone: 'Asia/Shanghai',
    },
    actions: ['check_in'],
  });

  assert.equal(state.totalDays, 7);
  assert.equal(state.claimedDays, 2);
  assert.equal(state.canCheckIn, true);
  assert.deepEqual(resolvePrimaryAction(state), {
    kind: 'check_in',
    label: '立即签到',
    disabled: false,
  });
});

test('builds claimed, next and future day states', () => {
  const days = buildDayItems({
    totalDays: 7,
    claimedDays: 2,
    completed: false,
  });

  assert.equal(days[0].claimed, true);
  assert.equal(days[1].claimed, true);
  assert.equal(days[2].next, true);
  assert.equal(days[3].claimed, false);
});

test('login and already-claimed states cannot execute a second claim', () => {
  const guest = normalizeActivityContext({
    lifecycleState: ActivityLifecycle.Active,
    authenticated: false,
    loginRequired: true,
    state: { totalDays: 7 },
    actions: [],
  });
  assert.equal(resolvePrimaryAction(guest).kind, 'login');

  const claimed = normalizeActivityContext({
    lifecycleState: ActivityLifecycle.Active,
    authenticated: true,
    loginRequired: true,
    state: { totalDays: 7, claimedDays: 1, claimedToday: true },
    actions: [],
  });
  assert.deepEqual(resolvePrimaryAction(claimed), {
    kind: 'claimed',
    label: '今日已签到',
    disabled: true,
  });
});

test('maps server lifecycle states to terminal copy', () => {
  assert.equal(
    resolveTerminalCopy(ActivityLifecycle.NotStarted).title,
    '活动尚未开始',
  );
  assert.equal(
    resolveTerminalCopy(ActivityLifecycle.Ended).title,
    '活动已结束',
  );
  assert.equal(
    resolveTerminalCopy(ActivityLifecycle.Superseded).title,
    '活动已更新',
  );
});

test('builds an allowed and bounded idempotency key', () => {
  const value = buildIdempotencyKey(
    123,
    '2026-07-28',
    '54b8a0d0-2f1e-41f4-9694-86fae85d43ac',
  );

  assert.match(value, /^[A-Za-z0-9._:-]+$/);
  assert.ok(value.length <= 64);
});
