import { describe, expect, it } from 'vitest';
import { safeFilename } from './filename.js';

describe('safeFilename', () => {
  it('keeps a normal filename', () => {
    expect(safeFilename('report.pdf')).toBe('report.pdf');
  });

  it('strips directory components and traversal', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('C:\\Windows\\system32\\evil.exe')).toBe('evil.exe');
  });

  it('removes leading dots and quotes', () => {
    expect(safeFilename('.hidden')).toBe('hidden');
    expect(safeFilename('a"b.txt')).toBe('ab.txt');
  });

  it('falls back when nothing safe remains', () => {
    expect(safeFilename('')).toBe('attachment');
    expect(safeFilename('/////')).toBe('attachment');
  });
});
