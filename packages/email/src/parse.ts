import PostalMime from 'postal-mime';
import { sanitizeHtml } from './sanitize.js';

// MIME parsing (CLAUDE.md §8). Isolated here and used only by the processor
// Worker. Applies bounded limits so a hostile message cannot exhaust resources.

export interface ParseLimits {
  maxAttachments: number;
  maxTextBytes: number;
  maxHtmlBytes: number;
  snippetChars: number;
}

export const DEFAULT_PARSE_LIMITS: ParseLimits = {
  maxAttachments: 25,
  maxTextBytes: 256 * 1024,
  maxHtmlBytes: 512 * 1024,
  snippetChars: 200,
};

export interface ParsedAttachment {
  filename: string;
  mimeType: string;
  contentId: string | null;
  disposition: 'attachment' | 'inline';
  content: Uint8Array;
  size: number;
}

export interface ParsedEmail {
  subject: string;
  fromAddress: string;
  fromName: string | null;
  textBody: string | null;
  htmlSanitized: string | null;
  snippet: string;
  hasAttachments: boolean;
  attachments: ParsedAttachment[];
  blockedRemoteImages: number;
}

function truncateBytes(value: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(value);
  if (encoded.length <= maxBytes) return value;
  // Decode a byte-truncated slice, dropping any partial trailing code point.
  return new TextDecoder().decode(encoded.slice(0, maxBytes));
}

function buildSnippet(text: string | null, html: string | null, maxChars: number): string {
  const source = text ?? (html ? html.replace(/<[^>]*>/g, ' ') : '');
  const collapsed = source.replace(/\s+/g, ' ').trim();
  return collapsed.length <= maxChars ? collapsed : `${collapsed.slice(0, maxChars - 1)}…`;
}

function toBytes(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === 'string') return new TextEncoder().encode(content);
  if (content instanceof Uint8Array) return content;
  return new Uint8Array(content);
}

/**
 * Parse raw MIME into safe, bounded metadata. HTML is sanitized before it is
 * ever returned; callers never see raw HTML.
 */
export async function parseEmail(
  raw: ArrayBuffer | Uint8Array,
  limits: ParseLimits = DEFAULT_PARSE_LIMITS,
): Promise<ParsedEmail> {
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const email = await new PostalMime().parse(bytes);

  const rawText = typeof email.text === 'string' && email.text.length > 0 ? email.text : null;
  const textBody = rawText === null ? null : truncateBytes(rawText, limits.maxTextBytes);

  let htmlSanitized: string | null = null;
  let blockedRemoteImages = 0;
  if (typeof email.html === 'string' && email.html.length > 0) {
    const result = sanitizeHtml(truncateBytes(email.html, limits.maxHtmlBytes));
    htmlSanitized = result.html;
    blockedRemoteImages = result.blockedRemoteImages;
  }

  const attachments: ParsedAttachment[] = [];
  for (const att of email.attachments ?? []) {
    if (attachments.length >= limits.maxAttachments) break;
    const content = toBytes(att.content);
    attachments.push({
      filename: att.filename ?? '',
      mimeType: att.mimeType || 'application/octet-stream',
      contentId: att.contentId ?? null,
      disposition: att.disposition === 'inline' ? 'inline' : 'attachment',
      content,
      size: content.byteLength,
    });
  }

  return {
    subject: (email.subject ?? '').slice(0, 1000),
    fromAddress: email.from?.address ?? '',
    fromName: email.from?.name && email.from.name.length > 0 ? email.from.name : null,
    textBody,
    htmlSanitized,
    snippet: buildSnippet(textBody, htmlSanitized, limits.snippetChars),
    hasAttachments: attachments.length > 0,
    attachments,
    blockedRemoteImages,
  };
}
