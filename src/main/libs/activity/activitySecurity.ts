import {
  type ActivityBounds,
  ActivityWebAppKey,
  type ActivityWebAppKey as ActivityWebAppKeyValue,
} from '../../../shared/activity/constants';

const TEST_GENERIC_ACTIVITY_BASE_URL =
  'https://lobsterai.inner.youdao.com/activities/generic-v1/';
const PROD_GENERIC_ACTIVITY_BASE_URL =
  'https://lobsterai.youdao.com/activities/generic-v1/';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const MIN_ACTIVITY_WIDTH = 320;
const MIN_ACTIVITY_HEIGHT = 240;

export interface ActivityWebAppLocation {
  url: string;
  allowedBaseUrl: string;
}

function normalizedBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.hash) {
    throw new Error('Activity web app URL must not contain credentials or a fragment');
  }
  url.search = '';
  if (!url.pathname.endsWith('/')) {
    url.pathname += '/';
  }
  return url.toString();
}

export function resolveActivityWebAppLocation(input: {
  webAppKey: ActivityWebAppKeyValue;
  activityCode: string;
  configRevision: number;
  locale: string;
  isPackaged: boolean;
  isTestMode: boolean;
  developmentOverride?: string;
}): ActivityWebAppLocation {
  if (input.webAppKey !== ActivityWebAppKey.GenericV1) {
    throw new Error(`Unsupported activity web app key: ${input.webAppKey}`);
  }

  let baseUrl = input.isTestMode
    ? TEST_GENERIC_ACTIVITY_BASE_URL
    : PROD_GENERIC_ACTIVITY_BASE_URL;
  if (!input.isPackaged && input.developmentOverride?.trim()) {
    const override = new URL(input.developmentOverride.trim());
    if (!['http:', 'https:'].includes(override.protocol)
        || !LOOPBACK_HOSTS.has(override.hostname)) {
      throw new Error('Development activity URL must use HTTP(S) on a loopback host');
    }
    baseUrl = override.toString();
  }
  const allowedBaseUrl = normalizedBaseUrl(baseUrl);
  const url = new URL(allowedBaseUrl);
  url.searchParams.set('activityCode', input.activityCode);
  url.searchParams.set('configRevision', String(input.configRevision));
  url.searchParams.set('locale', input.locale);
  return { url: url.toString(), allowedBaseUrl };
}

export function isAllowedActivityNavigation(targetUrl: string, allowedBaseUrl: string): boolean {
  try {
    const target = new URL(targetUrl);
    const allowed = new URL(normalizedBaseUrl(allowedBaseUrl));
    return !target.username
      && !target.password
      && target.origin === allowed.origin
      && target.pathname.startsWith(allowed.pathname);
  } catch {
    return false;
  }
}

export function isAllowedActivityResource(targetUrl: string, allowedBaseUrl: string): boolean {
  if (targetUrl.startsWith('data:')) {
    return true;
  }
  if (targetUrl.startsWith('blob:')) {
    return isAllowedActivityNavigation(targetUrl.slice('blob:'.length), allowedBaseUrl);
  }
  return isAllowedActivityNavigation(targetUrl, allowedBaseUrl);
}

export function validateActivityBounds(
  bounds: ActivityBounds,
  parentBounds: ActivityBounds,
): ActivityBounds {
  const values = [bounds.x, bounds.y, bounds.width, bounds.height];
  if (!values.every(Number.isInteger)) {
    throw new Error('Activity bounds must contain finite integers');
  }
  if (bounds.x < 0 || bounds.y < 0
      || bounds.width < MIN_ACTIVITY_WIDTH
      || bounds.height < MIN_ACTIVITY_HEIGHT) {
    throw new Error('Activity bounds are outside the supported range');
  }
  if (bounds.x + bounds.width > parentBounds.width
      || bounds.y + bounds.height > parentBounds.height) {
    throw new Error('Activity bounds must stay inside the main window');
  }
  return { ...bounds };
}
