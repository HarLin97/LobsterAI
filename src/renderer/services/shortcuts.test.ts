import { describe, expect, test } from 'vitest';

import { isTextEditingSafeShortcut } from './shortcuts';

describe('isTextEditingSafeShortcut', () => {
  test('returns false for empty or missing bindings', () => {
    expect(isTextEditingSafeShortcut(undefined)).toBe(false);
    expect(isTextEditingSafeShortcut('')).toBe(false);
  });

  test('accepts bindings carrying a Cmd/Ctrl modifier', () => {
    expect(isTextEditingSafeShortcut('CommandOrControl+Shift+H')).toBe(true);
    expect(isTextEditingSafeShortcut('CommandOrControl+/')).toBe(true);
    expect(isTextEditingSafeShortcut('Ctrl+Alt+H')).toBe(true);
    expect(isTextEditingSafeShortcut('Cmd+K')).toBe(true);
  });

  test('rejects bindings that plain typing could produce', () => {
    expect(isTextEditingSafeShortcut('Enter')).toBe(false);
    expect(isTextEditingSafeShortcut('Shift+H')).toBe(false);
    // Alt alone is unsafe: Option+key inserts special characters on macOS.
    expect(isTextEditingSafeShortcut('Alt+H')).toBe(false);
  });
});
