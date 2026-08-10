/**
 * Display-side extraction of file/folder attachment lines from user messages.
 *
 * When a prompt is submitted with non-image attachments, prepareCoworkPromptPayload
 * appends machine-generated lines like "输入文件: /abs/path" to the prompt text.
 * This module parses those lines back out at render time so the UI can show
 * clickable attachment cards instead of raw path text.
 * DISPLAY ONLY — does not affect what was sent to the AI model.
 */

// Labels ever produced by the payload builder (i18n `inputFileLabel` /
// `inputFolderLabel`, plus the pre-i18n hardcoded value). Longest-first so
// "输入文件夹" wins over its prefix "输入文件".
const FOLDER_LABELS = ['输入文件夹', 'Input Folder'] as const;
const FILE_LABELS = ['输入文件', 'Input Files'] as const;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const LABEL_ALTERNATION = [...FOLDER_LABELS, ...FILE_LABELS].map(escapeRegExp).join('|');

// Absolute paths only: POSIX (/...), Windows drive (C:\... or C:/...), UNC (\\...).
// Paths may contain spaces, so the path part runs to end of line.
const ATTACHMENT_LINE_RE = new RegExp(
  `^[ \\t]*(${LABEL_ALTERNATION}): ((?:\\/|[A-Za-z]:[\\\\/]|\\\\\\\\)[^\\n]*?)[ \\t]*$`,
  'gm',
);

export interface UserMessageFileAttachment {
  path: string;
  name: string;
  isDirectory: boolean;
}

export interface ExtractedUserMessageFileAttachments {
  text: string;
  attachments: UserMessageFileAttachment[];
}

function deriveAttachmentName(rawPath: string): string {
  const trimmed = rawPath.replace(/[\\/]+$/, '');
  const lastSeparator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  const name = lastSeparator >= 0 ? trimmed.slice(lastSeparator + 1) : trimmed;
  return name || rawPath;
}

function normalizePathKey(rawPath: string): string {
  return rawPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Splits attachment lines out of a user message. Returns the remaining text
 * (with attachment lines removed and blank runs collapsed) plus the parsed
 * attachments in appearance order. Content without attachment lines is
 * returned unchanged.
 */
export function extractUserMessageFileAttachments(
  content: string,
): ExtractedUserMessageFileAttachments {
  if (!content) {
    return { text: content, attachments: [] };
  }

  const attachments: UserMessageFileAttachment[] = [];
  const seenPathKeys = new Set<string>();

  const re = new RegExp(ATTACHMENT_LINE_RE.source, ATTACHMENT_LINE_RE.flags);
  const text = content
    .replace(re, (_match, label: string, rawPath: string) => {
      const path = rawPath.trim();
      if (path) {
        const key = normalizePathKey(path);
        if (!seenPathKeys.has(key)) {
          seenPathKeys.add(key);
          attachments.push({
            path,
            name: deriveAttachmentName(path),
            isDirectory: (FOLDER_LABELS as readonly string[]).includes(label),
          });
        }
      }
      return '';
    });

  if (attachments.length === 0) {
    return { text: content, attachments: [] };
  }

  return {
    text: text.replace(/\n{3,}/g, '\n\n').trim(),
    attachments,
  };
}
