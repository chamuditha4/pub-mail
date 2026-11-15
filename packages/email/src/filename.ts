// Filename sanitization for safe display and download (CLAUDE.md §12). User
// filenames are NEVER used as R2 keys (keys are derived from internal IDs); this
// only produces a safe name for the Content-Disposition header and the UI.

const MAX_LEN = 200;
// Control chars (0x00-0x1F, DEL), quotes, and path separators. Built from a
// string so no literal control characters appear in the source.
const UNSAFE = new RegExp('[\\u0000-\\u001f\\u007f"\\\\/]', 'g');
const PATH_SEP = new RegExp('[\\\\/]');

/**
 * Produce a storage/header-safe filename: strip path separators and control
 * characters, collapse whitespace, and bound the length. Falls back to a
 * generic name when nothing safe remains.
 */
export function safeFilename(original: string, fallback = 'attachment'): string {
  if (!original) return fallback;
  // Take the basename only — drop any directory components.
  const base = original.split(PATH_SEP).pop() ?? '';
  const cleaned = base
    .replace(UNSAFE, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '') // no leading dots (hidden files / traversal)
    .trim();
  if (cleaned.length === 0) return fallback;
  return cleaned.length > MAX_LEN ? cleaned.slice(0, MAX_LEN) : cleaned;
}
