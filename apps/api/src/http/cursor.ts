// Opaque cursor pagination (CLAUDE.md §9: opaque cursors, never page numbers).
// The cursor is an inbox-message id, base64url-encoded so clients treat it as
// opaque.

export function encodeCursor(id: string): string {
  return btoa(id).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor(cursor: string): string | null {
  try {
    const b64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(b64);
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}
