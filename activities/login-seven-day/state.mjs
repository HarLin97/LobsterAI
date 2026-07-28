export const ActivityLifecycle = Object.freeze({
  Active: 'active',
  NotStarted: 'not_started',
  Ended: 'ended',
  Offline: 'offline',
  Superseded: 'superseded',
});

export const ActivityAction = Object.freeze({
  CheckIn: 'check_in',
});

const asPositiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const asNonNegativeInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const asPositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const asText = (value, fallback = '') => (
  typeof value === 'string' && value.trim() ? value.trim() : fallback
);

export function normalizeActivityContext(context) {
  const state = context?.state && typeof context.state === 'object'
    ? context.state
    : {};
  const presentation = context?.presentationConfig
    && typeof context.presentationConfig === 'object'
    ? context.presentationConfig
    : {};
  const totalDays = Math.min(365, asPositiveInteger(state.totalDays, 7));
  const claimedDays = Math.min(
    totalDays,
    asNonNegativeInteger(state.claimedDays, 0),
  );
  const actions = Array.isArray(context?.actions)
    ? context.actions.filter(value => typeof value === 'string')
    : [];

  return {
    lifecycleState: asText(context?.lifecycleState, ActivityLifecycle.Offline),
    authenticated: Boolean(context?.authenticated),
    loginRequired: Boolean(context?.loginRequired),
    serverTime: asText(context?.serverTime),
    totalDays,
    claimedDays,
    claimedToday: Boolean(state.claimedToday),
    completed: Boolean(state.completed) || claimedDays >= totalDays,
    rewardCredits: asPositiveNumber(state.rewardCredits, 10),
    timezone: asText(state.timezone, 'Asia/Shanghai'),
    canCheckIn: actions.includes(ActivityAction.CheckIn),
    presentation,
  };
}

export function buildDayItems(state) {
  return Array.from({ length: state.totalDays }, (_, index) => {
    const day = index + 1;
    const claimed = day <= state.claimedDays;
    const next = !claimed && day === state.claimedDays + 1 && !state.completed;
    return {
      day,
      claimed,
      next,
      label: `第${day}天`,
      icon: String(day),
    };
  });
}

export function resolvePrimaryAction(state) {
  if (state.lifecycleState !== ActivityLifecycle.Active) {
    return { kind: 'unavailable', label: '活动暂不可用', disabled: true };
  }
  if (state.loginRequired && !state.authenticated) {
    return { kind: 'login', label: '登录后签到', disabled: false };
  }
  if (state.completed) {
    return { kind: 'completed', label: '7 天奖励已全部领取', disabled: true };
  }
  if (state.claimedToday) {
    return { kind: 'claimed', label: '今日已签到', disabled: true };
  }
  if (state.canCheckIn) {
    return { kind: 'check_in', label: '立即签到', disabled: false };
  }
  return { kind: 'refresh', label: '刷新活动状态', disabled: false };
}

export function resolveTerminalCopy(lifecycleState) {
  if (lifecycleState === ActivityLifecycle.NotStarted) {
    return {
      icon: '◷',
      title: '活动尚未开始',
      copy: '活动入口将在开始时间后开放，请稍后再来。',
    };
  }
  if (lifecycleState === ActivityLifecycle.Ended) {
    return {
      icon: '✓',
      title: '活动已结束',
      copy: '感谢参与，本页面将在下次打开或刷新后不再展示。',
    };
  }
  if (lifecycleState === ActivityLifecycle.Superseded) {
    return {
      icon: '↻',
      title: '活动已更新',
      copy: '请关闭当前窗口，再从 LobsterAI 侧边栏重新进入。',
    };
  }
  return {
    icon: '!',
    title: '活动暂不可用',
    copy: '活动可能已下线，请关闭页面后稍后再试。',
  };
}

export function buildIdempotencyKey(configRevision, periodKey, randomId) {
  const revision = String(configRevision).replace(/[^0-9]/g, '').slice(0, 8) || '0';
  const period = String(periodKey).replace(/[^0-9-]/g, '').slice(0, 10);
  const random = String(randomId).replace(/[^A-Za-z0-9-]/g, '').slice(0, 36);
  return `checkin:${revision}:${period}:${random}`.slice(0, 64);
}

export function formatBusinessDate(serverTime, timezone) {
  const date = new Date(serverTime);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
