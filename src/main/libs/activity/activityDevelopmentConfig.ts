interface ResolveActivityServerBaseUrlInput {
  defaultBaseUrl: string;
  developmentOverride?: string;
  isDev: boolean;
  isPackaged: boolean;
}

const LOOPBACK_HOSTNAMES = new Set([
  '127.0.0.1',
  'localhost',
  '[::1]',
]);

export function resolveActivityServerBaseUrl(
  input: ResolveActivityServerBaseUrlInput,
): string {
  const override = input.developmentOverride?.trim();
  if (!override || !input.isDev || input.isPackaged) {
    return input.defaultBaseUrl;
  }

  let url: URL;
  try {
    url = new URL(override);
  } catch {
    throw new Error('Activity development server override must be an absolute URL');
  }

  if ((url.protocol !== 'http:' && url.protocol !== 'https:')
      || !LOOPBACK_HOSTNAMES.has(url.hostname)) {
    throw new Error(
      'Activity development server override must use loopback HTTP(S)',
    );
  }
  if (url.username || url.password || url.search || url.hash
      || (url.pathname !== '' && url.pathname !== '/')) {
    throw new Error(
      'Activity development server override must be a credential-free origin URL',
    );
  }

  return url.origin;
}
