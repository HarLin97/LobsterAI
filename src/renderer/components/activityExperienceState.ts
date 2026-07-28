import type { ActivityDescriptor } from '../../shared/activity/constants';

export interface ActivityEntryModel {
  title: string;
  description?: string;
  badgeText?: string;
  ctaText?: string;
  imageUrl?: string;
  accentColor: string;
}

export interface ActivityModalDimensions {
  width: number;
  height: number;
}

const DEFAULT_ACCENT_COLOR = '#FF6B35';
const HTTPS_PROTOCOL = 'https:';
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

const readText = (value: unknown): string | undefined => (
  typeof value === 'string' && value.trim() ? value.trim() : undefined
);

const readSafeImageUrl = (value: unknown): string | undefined => {
  const text = readText(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase();
    const isIpLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
      || host.includes(':');
    return url.protocol === HTTPS_PROTOCOL
      && !url.username
      && !url.password
      && host.includes('.')
      && !isIpLiteral
      && host !== 'localhost'
      && !RESERVED_HOST_SUFFIXES.some(suffix => host.endsWith(suffix))
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

const readAccentColor = (value: unknown): string => {
  const text = readText(value);
  return text && /^#[0-9A-Fa-f]{6}$/.test(text)
    ? text
    : DEFAULT_ACCENT_COLOR;
};

export const resolveActivityEntryModel = (
  descriptor: ActivityDescriptor,
): ActivityEntryModel | null => {
  const entry = descriptor.entryConfig ?? {};
  const presentation = descriptor.presentationConfig ?? {};
  const title = readText(entry.title) ?? readText(presentation.title);
  if (!title) return null;

  return {
    title,
    description: readText(entry.description) ?? readText(presentation.subtitle),
    badgeText: readText(entry.badgeText),
    ctaText: readText(entry.ctaText),
    imageUrl: readSafeImageUrl(entry.imageUrl),
    accentColor: readAccentColor(entry.accentColor),
  };
};

export const resolveActivityModalTitle = (descriptor: ActivityDescriptor): string => (
  readText(descriptor.presentationConfig?.title)
  ?? readText(descriptor.entryConfig?.title)
  ?? ''
);

export const resolveActivityModalDimensions = (
  sizePreset: string,
): ActivityModalDimensions => {
  if (sizePreset === 'large') {
    return { width: 720, height: 680 };
  }
  if (sizePreset === 'medium') {
    return { width: 560, height: 620 };
  }
  return { width: 420, height: 540 };
};
