import {
  ActivityAction,
  ActivityLifecycle,
  buildDayItems,
  buildIdempotencyKey,
  formatBusinessDate,
  normalizeActivityContext,
  resolvePrimaryAction,
  resolveTerminalCopy,
} from './state.mjs';

const query = new URLSearchParams(window.location.search);
const previewMode = query.get('preview') === '1';
const bridge = window.lobsterActivity;

const elements = {
  previewBadge: document.querySelector('#preview-badge'),
  title: document.querySelector('#title'),
  subtitle: document.querySelector('#subtitle'),
  eyebrow: document.querySelector('#eyebrow'),
  rewardNumber: document.querySelector('#reward-number'),
  loadingView: document.querySelector('#loading-view'),
  mainView: document.querySelector('#main-view'),
  terminalView: document.querySelector('#terminal-view'),
  progressCopy: document.querySelector('#progress-copy'),
  todayStatus: document.querySelector('#today-status'),
  dayList: document.querySelector('#day-list'),
  messageCard: document.querySelector('#message-card'),
  messageTitle: document.querySelector('#message-title'),
  messageCopy: document.querySelector('#message-copy'),
  primaryAction: document.querySelector('#primary-action'),
  primaryLabel: document.querySelector('#primary-label'),
  actionHint: document.querySelector('#action-hint'),
  rulesPanel: document.querySelector('#rules-panel'),
  rulesList: document.querySelector('#rules-list'),
  terminalIcon: document.querySelector('#terminal-icon'),
  terminalTitle: document.querySelector('#terminal-title'),
  terminalCopy: document.querySelector('#terminal-copy'),
  terminalAction: document.querySelector('#terminal-action'),
  successToast: document.querySelector('#success-toast'),
  successTitle: document.querySelector('#success-title'),
  successCopy: document.querySelector('#success-copy'),
};

const defaultPresentation = {
  eyebrow: '连续登录奖励',
  title: '登录送7天积分',
  subtitle: '每天登录并签到，连续 7 天领取奖励',
  rules: [
    '活动期间每天可签到一次',
    '积分到账后有效期为 30 天',
    '活动时间和领取资格以服务端为准',
  ],
  theme: {
    accentColor: '#FF6B35',
    backgroundColor: '#FFF7F1',
  },
};

let runtimeContext = null;
let activityState = null;
let actionInFlight = false;
let toastTimer = 0;
let unsubscribeAuth = null;

const setVisibleView = (name) => {
  elements.loadingView.hidden = name !== 'loading';
  elements.mainView.hidden = name !== 'main';
  elements.terminalView.hidden = name !== 'terminal';
};

const readText = (value, fallback) => (
  typeof value === 'string' && value.trim() ? value.trim() : fallback
);

const readColor = (value, fallback) => (
  typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value)
    ? value
    : fallback
);

const applyPresentation = (presentation = {}) => {
  const merged = { ...defaultPresentation, ...presentation };
  const theme = {
    ...defaultPresentation.theme,
    ...(presentation.theme && typeof presentation.theme === 'object'
      ? presentation.theme
      : {}),
  };
  const accent = readColor(theme.accentColor, defaultPresentation.theme.accentColor);
  const background = readColor(
    theme.backgroundColor,
    defaultPresentation.theme.backgroundColor,
  );
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--surface', background);
  elements.eyebrow.textContent = readText(merged.eyebrow, defaultPresentation.eyebrow);
  elements.title.textContent = readText(merged.title, defaultPresentation.title);
  elements.subtitle.textContent = readText(merged.subtitle, defaultPresentation.subtitle);

  const rules = Array.isArray(merged.rules)
    ? merged.rules.filter(value => typeof value === 'string' && value.trim()).slice(0, 8)
    : defaultPresentation.rules;
  elements.rulesList.replaceChildren(
    ...rules.map((rule) => {
      const item = document.createElement('li');
      item.textContent = rule;
      return item;
    }),
  );
  elements.rulesPanel.hidden = rules.length === 0;
};

const renderDays = (state) => {
  elements.dayList.replaceChildren(
    ...buildDayItems(state).map((item) => {
      const node = document.createElement('li');
      node.className = [
        'day-item',
        item.claimed ? 'is-claimed' : '',
        item.next ? 'is-next' : '',
      ].filter(Boolean).join(' ');
      node.dataset.icon = item.icon;
      const label = document.createElement('span');
      label.textContent = item.label;
      node.append(label);
      return node;
    }),
  );
};

const renderMessage = (state) => {
  if (state.completed) {
    elements.messageCard.hidden = false;
    elements.messageTitle.textContent = '全部奖励已领取';
    elements.messageCopy.textContent = `连续 ${state.totalDays} 天签到完成，感谢参与。`;
    return;
  }
  if (state.claimedToday) {
    elements.messageCard.hidden = false;
    elements.messageTitle.textContent = '今日签到完成';
    elements.messageCopy.textContent = `明天再来，可继续领取 ${state.rewardCredits} 积分。`;
    return;
  }
  elements.messageCard.hidden = true;
};

const renderMain = (state) => {
  applyPresentation(state.presentation);
  elements.rewardNumber.textContent = String(state.rewardCredits);
  elements.progressCopy.textContent = `已完成 ${state.claimedDays} / ${state.totalDays} 天`;
  elements.todayStatus.textContent = state.claimedToday ? '今日已完成' : '今日待签到';
  elements.todayStatus.classList.toggle('is-complete', state.claimedToday);
  renderDays(state);
  renderMessage(state);

  const action = resolvePrimaryAction(state);
  elements.primaryLabel.textContent = action.label;
  elements.primaryAction.disabled = action.disabled || actionInFlight;
  elements.primaryAction.dataset.action = action.kind;
  elements.actionHint.textContent = state.authenticated
    ? '奖励将直接发放到当前登录账号'
    : '登录只在 LobsterAI 客户端内完成，活动页不会获得账号令牌';
  setVisibleView('main');
};

const renderTerminal = (lifecycleState, override = null) => {
  const copy = override || resolveTerminalCopy(lifecycleState);
  elements.terminalIcon.textContent = copy.icon;
  elements.terminalTitle.textContent = copy.title;
  elements.terminalCopy.textContent = copy.copy;
  setVisibleView('terminal');
};

const showSuccess = (credits) => {
  window.clearTimeout(toastTimer);
  elements.successTitle.textContent = '签到成功';
  elements.successCopy.textContent = `${credits} 积分已到账`;
  elements.successToast.hidden = false;
  toastTimer = window.setTimeout(() => {
    elements.successToast.hidden = true;
  }, 3200);
};

const createPreviewContext = () => ({
  lifecycleState: ActivityLifecycle.Active,
  authenticated: true,
  loginRequired: true,
  serverTime: new Date().toISOString(),
  presentationConfig: defaultPresentation,
  state: {
    totalDays: 7,
    claimedDays: 2,
    remainingDays: 5,
    claimedToday: false,
    completed: false,
    rewardCredits: 10,
    timezone: 'Asia/Shanghai',
  },
  actions: [ActivityAction.CheckIn],
});

const loadContext = async () => {
  setVisibleView('loading');
  if (previewMode) {
    activityState = normalizeActivityContext(createPreviewContext());
    renderMain(activityState);
    return;
  }
  if (!bridge) {
    renderTerminal(ActivityLifecycle.Offline, {
      icon: '⌂',
      title: '请在 Lobster AI 中打开',
      copy: '这是应用内活动页面，普通浏览器不会获得登录态或活动操作能力。',
    });
    return;
  }

  const runtimeResult = await bridge.getRuntimeContext();
  if (!runtimeResult?.success) {
    renderTerminal(ActivityLifecycle.Offline);
    return;
  }
  runtimeContext = runtimeResult.data;
  const contextResult = await bridge.getActivityContext();
  if (!contextResult?.success) {
    renderTerminal(ActivityLifecycle.Offline, {
      icon: '↻',
      title: '状态读取失败',
      copy: '网络可能暂时不可用，请关闭页面后重试。',
    });
    return;
  }

  activityState = normalizeActivityContext(contextResult.data);
  if (activityState.lifecycleState !== ActivityLifecycle.Active) {
    applyPresentation(activityState.presentation);
    renderTerminal(activityState.lifecycleState);
    return;
  }
  renderMain(activityState);
};

const requestLogin = async () => {
  if (!bridge) return;
  actionInFlight = true;
  elements.primaryLabel.textContent = '正在打开登录…';
  elements.primaryAction.disabled = true;
  try {
    const result = await bridge.requestLogin();
    if (!result?.success) {
      throw new Error(result?.error || 'login failed');
    }
    elements.primaryLabel.textContent = '完成登录后自动刷新';
    elements.actionHint.textContent = '请在 LobsterAI 登录窗口中完成操作';
  } catch {
    actionInFlight = false;
    renderMain(activityState);
    elements.actionHint.textContent = '登录窗口打开失败，请稍后重试';
  }
};

const getIdempotencyKey = () => {
  const periodKey = formatBusinessDate(
    activityState.serverTime,
    activityState.timezone,
  );
  const storageKey = [
    'lobster.activity.checkin',
    runtimeContext.activityCode,
    runtimeContext.configRevision,
    periodKey,
  ].join('.');
  let value = sessionStorage.getItem(storageKey);
  if (!value) {
    const randomId = crypto.randomUUID();
    value = buildIdempotencyKey(
      runtimeContext.configRevision,
      periodKey,
      randomId,
    );
    sessionStorage.setItem(storageKey, value);
  }
  return value;
};

const executeCheckIn = async () => {
  if (!bridge || actionInFlight) return;
  actionInFlight = true;
  elements.primaryAction.disabled = true;
  elements.primaryLabel.textContent = '正在领取…';
  let failureMessage = '';
  try {
    const result = await bridge.executeAction({
      actionId: ActivityAction.CheckIn,
      idempotencyKey: getIdempotencyKey(),
      payload: { surface: 'login-seven-day-h5-v1' },
    });
    if (!result?.success) {
      throw new Error(result?.error || 'claim failed');
    }
    activityState = normalizeActivityContext(result.data.context);
    renderMain(activityState);
    showSuccess(result.data.result?.creditsGranted ?? activityState.rewardCredits);
  } catch {
    failureMessage = '领取失败，请稍后重试；重复点击不会重复发放';
  } finally {
    actionInFlight = false;
    if (activityState) {
      renderMain(activityState);
      if (failureMessage) elements.actionHint.textContent = failureMessage;
    }
  }
};

elements.primaryAction.addEventListener('click', () => {
  const action = elements.primaryAction.dataset.action;
  if (previewMode && action === 'check_in') {
    activityState = normalizeActivityContext({
      ...createPreviewContext(),
      state: {
        ...createPreviewContext().state,
        claimedDays: 3,
        claimedToday: true,
      },
      actions: [],
    });
    renderMain(activityState);
    showSuccess(activityState.rewardCredits);
    return;
  }
  if (action === 'login') {
    void requestLogin();
  } else if (action === 'check_in') {
    void executeCheckIn();
  } else if (action === 'refresh') {
    void loadContext();
  }
});

elements.terminalAction.addEventListener('click', () => {
  if (bridge) void bridge.close();
});

if (previewMode) {
  elements.previewBadge.hidden = false;
}

if (bridge?.onAuthChanged) {
  unsubscribeAuth = bridge.onAuthChanged((event) => {
    if (event?.authenticated) {
      actionInFlight = false;
      void loadContext();
    }
  });
}

window.addEventListener('pagehide', () => {
  if (typeof unsubscribeAuth === 'function') unsubscribeAuth();
  window.clearTimeout(toastTimer);
}, { once: true });

void loadContext();
