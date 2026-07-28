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
const RESERVED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home',
  '.test',
  '.invalid',
  '.example',
  '.onion',
];
const MAX_RESOURCE_BASE_URLS = 16;
const MIN_ACTIVITY_WIDTH = 320;
const MIN_ACTIVITY_HEIGHT = 240;

export interface ActivityWebAppLocation {
  url: string;
  navigationBaseUrl: string;
  resourceBaseUrls: string[];
}

function validatePublicHttpsUrl(value: string, field: string): URL {
  if (!value.trim() || value.length > 2048) {
    throw new Error(`${field} is missing or too long`);
  }
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error(`${field} must be public HTTPS without credentials or a fragment`);
  }

  const host = url.hostname.toLowerCase();
  const isIpLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':');
  if (!host.includes('.')
      || isIpLiteral
      || host === 'localhost'
      || RESERVED_HOST_SUFFIXES.some(suffix => host.endsWith(suffix))) {
    throw new Error(`${field} must use a public DNS hostname`);
  }
  return url;
}

function normalizedBaseUrl(value: string, field = 'Activity base URL'): string {
  const url = validatePublicHttpsUrl(value, field);
  if (url.search) {
    throw new Error(`${field} must not contain a query`);
  }
  if (!url.pathname.endsWith('/')) {
    url.pathname += '/';
  }
  return url.toString();
}

function deriveNavigationBaseUrl(webAppUrl: URL): string {
  const base = new URL(webAppUrl.toString());
  base.search = '';
  if (!base.pathname.endsWith('/')) {
    const slash = base.pathname.lastIndexOf('/');
    base.pathname = slash >= 0 ? base.pathname.slice(0, slash + 1) : '/';
  }
  return normalizedBaseUrl(base.toString(), 'Derived navigationBaseUrl');
}

function resolveDevelopmentLocation(value: string): ActivityWebAppLocation {
  const override = new URL(value.trim());
  if (!['http:', 'https:'].includes(override.protocol)
      || !LOOPBACK_HOSTS.has(override.hostname)
      || override.username
      || override.password
      || override.hash) {
    throw new Error('Development activity URL must use HTTP(S) on a loopback host');
  }
  override.search = '';
  if (!override.pathname.endsWith('/')) {
    override.pathname += '/';
  }
  return {
    url: override.toString(),
    navigationBaseUrl: override.toString(),
    resourceBaseUrls: [override.toString()],
  };
}

function withRuntimeQuery(
  location: ActivityWebAppLocation,
  input: {
    activityCode: string;
    configRevision: number;
    locale: string;
  },
): ActivityWebAppLocation {
  const url = new URL(location.url);
  url.searchParams.set('activityCode', input.activityCode);
  url.searchParams.set('configRevision', String(input.configRevision));
  url.searchParams.set('locale', input.locale);
  return { ...location, url: url.toString() };
}

function resolveRemoteH5Location(input: {
  webAppUrl?: string;
  navigationBaseUrl?: string;
  resourceBaseUrls?: string[];
}): ActivityWebAppLocation {
  if (!input.webAppUrl) {
    throw new Error('Remote activity is missing webAppUrl');
  }
  const webAppUrl = validatePublicHttpsUrl(input.webAppUrl, 'webAppUrl');
  const navigationBaseUrl = input.navigationBaseUrl
    ? normalizedBaseUrl(input.navigationBaseUrl, 'navigationBaseUrl')
    : deriveNavigationBaseUrl(webAppUrl);
  if (new URL(navigationBaseUrl).origin !== webAppUrl.origin) {
    throw new Error('navigationBaseUrl must use the same origin as webAppUrl');
  }

  const configuredResources = input.resourceBaseUrls ?? [];
  if (configuredResources.length > MAX_RESOURCE_BASE_URLS) {
    throw new Error(`resourceBaseUrls supports at most ${MAX_RESOURCE_BASE_URLS} values`);
  }
  const resourceBaseUrls = Array.from(new Set([
    navigationBaseUrl,
    ...configuredResources.map(value => normalizedBaseUrl(value, 'resourceBaseUrls')),
  ]));
  return {
    url: webAppUrl.toString(),
    navigationBaseUrl,
    resourceBaseUrls,
  };
}

export function resolveActivityWebAppLocation(input: {
  webAppKey: ActivityWebAppKeyValue;
  webAppUrl?: string;
  navigationBaseUrl?: string;
  resourceBaseUrls?: string[];
  activityCode: string;
  configRevision: number;
  locale: string;
  isPackaged: boolean;
  isTestMode: boolean;
  developmentOverride?: string;
}): ActivityWebAppLocation {
  if (!input.isPackaged && input.developmentOverride?.trim()) {
    return withRuntimeQuery(
      resolveDevelopmentLocation(input.developmentOverride),
      input,
    );
  }

  if (input.webAppKey === ActivityWebAppKey.RemoteH5V1) {
    return withRuntimeQuery(resolveRemoteH5Location(input), input);
  }
  if (input.webAppKey !== ActivityWebAppKey.GenericV1) {
    throw new Error(`Unsupported activity web app key: ${input.webAppKey}`);
  }

  const genericBaseUrl = normalizedBaseUrl(
    input.isTestMode
      ? TEST_GENERIC_ACTIVITY_BASE_URL
      : PROD_GENERIC_ACTIVITY_BASE_URL,
  );
  return withRuntimeQuery({
    url: genericBaseUrl,
    navigationBaseUrl: genericBaseUrl,
    resourceBaseUrls: [genericBaseUrl],
  }, input);
}

export function isAllowedActivityNavigation(
  targetUrl: string,
  navigationBaseUrl: string,
): boolean {
  try {
    const target = new URL(targetUrl);
    const allowed = new URL(navigationBaseUrl);
    return !target.username
      && !target.password
      && target.origin === allowed.origin
      && target.pathname.startsWith(allowed.pathname);
  } catch {
    return false;
  }
}

export function isAllowedActivityResource(
  targetUrl: string,
  resourceBaseUrls: string[],
): boolean {
  if (targetUrl.startsWith('data:')) {
    return true;
  }
  if (targetUrl.startsWith('blob:')) {
    try {
      const blobOrigin = new URL(targetUrl.slice('blob:'.length)).origin;
      return resourceBaseUrls.some(base => new URL(base).origin === blobOrigin);
    } catch {
      return false;
    }
  }
  return resourceBaseUrls.some(
    baseUrl => isAllowedActivityNavigation(targetUrl, baseUrl),
  );
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
