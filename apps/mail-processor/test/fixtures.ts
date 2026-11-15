// Minimal sanitized .eml fixtures built with CRLF line endings. Never commit
// real user email (CLAUDE.md §17).

const crlf = (lines: string[]): string => lines.join('\r\n');

export const PLAIN_TEXT = crlf([
  'From: Alice <alice@example.net>',
  'To: user@public.example',
  'Subject: Plain hello',
  'Message-ID: <plain-1@example.net>',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Hello in plain text. This is the body.',
  '',
]);

export const HTML_WITH_SCRIPT_AND_IMAGE = crlf([
  'From: Bob <bob@example.net>',
  'To: user@public.example',
  'Subject: HTML message',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<html><body><h1>Heading</h1><p>Hi there</p>',
  '<script>alert("xss")</script>',
  '<img src="https://tracker.example/pixel.gif" alt="pixel">',
  '<a href="https://safe.example/path">a link</a>',
  '</body></html>',
  '',
]);

export const MULTIPART_WITH_ATTACHMENT = crlf([
  'From: Carol <carol@example.net>',
  'To: user@public.example',
  'Subject: With a text attachment',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="BOUNDARY1"',
  '',
  '--BOUNDARY1',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Please see the attached notes.',
  '--BOUNDARY1',
  'Content-Type: text/plain; name="notes.txt"',
  'Content-Disposition: attachment; filename="notes.txt"',
  '',
  'These are the note contents.',
  '--BOUNDARY1--',
  '',
]);

export const MULTIPART_WITH_BLOCKED_EXE = crlf([
  'From: Mallory <mallory@example.net>',
  'To: user@public.example',
  'Subject: Suspicious attachment',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="BOUNDARY2"',
  '',
  '--BOUNDARY2',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Open the attached program.',
  '--BOUNDARY2',
  'Content-Type: application/octet-stream; name="setup.exe"',
  'Content-Disposition: attachment; filename="setup.exe"',
  '',
  'MZ fake executable bytes',
  '--BOUNDARY2--',
  '',
]);
