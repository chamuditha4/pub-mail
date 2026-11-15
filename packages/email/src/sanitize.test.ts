import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from './sanitize.js';

describe('sanitizeHtml', () => {
  it('removes script tags and their contents', () => {
    const { html } = sanitizeHtml('<p>hi</p><script>alert(1)</script>');
    expect(html).toContain('<p>hi</p>');
    expect(html.toLowerCase()).not.toContain('script');
    expect(html).not.toContain('alert(1)');
  });

  it('strips event handler attributes', () => {
    const { html } = sanitizeHtml('<p onclick="steal()">click</p>');
    expect(html).not.toContain('onclick');
    expect(html).toContain('click');
  });

  it('drops javascript: hrefs but keeps safe links with safe rel/target', () => {
    const evil = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(evil.html).not.toContain('javascript');

    const safe = sanitizeHtml('<a href="https://example.com">x</a>');
    expect(safe.html).toContain('href="https://example.com"');
    expect(safe.html).toContain('rel="noopener noreferrer nofollow"');
    expect(safe.html).toContain('target="_blank"');
  });

  it('blocks remote images and counts them', () => {
    const { html, blockedRemoteImages } = sanitizeHtml(
      '<img src="https://tracker.example/pixel.gif" alt="x">',
    );
    // No active src attribute (data-tm-blocked-src is inert, preceded by '-').
    expect(html).not.toMatch(/\ssrc=/);
    expect(html).toContain('data-tm-blocked-src="https://tracker.example/pixel.gif"');
    expect(html).toContain('alt="x"');
    expect(blockedRemoteImages).toBe(1);
  });

  it('removes iframes, styles, forms and objects entirely', () => {
    const { html } = sanitizeHtml(
      '<iframe src="evil"></iframe><style>body{}</style><form><input></form><object></object>',
    );
    for (const tag of ['iframe', 'style', 'form', 'input', 'object']) {
      expect(html.toLowerCase()).not.toContain(`<${tag}`);
    }
  });

  it('preserves basic formatting and tables', () => {
    const input = '<h1>Title</h1><p><strong>bold</strong></p><table><tr><td>cell</td></tr></table>';
    const { html } = sanitizeHtml(input);
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<td>cell</td>');
  });
});
