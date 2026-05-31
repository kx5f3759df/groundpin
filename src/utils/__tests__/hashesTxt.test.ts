import { buildHashesTxt, parseHashesTxt } from '../hashesTxt';

describe('hashesTxt', () => {
  it('sorts paths in dictionary order and ends with LF', () => {
    const content = buildHashesTxt([
      { pathInZip: 'manifest.json', sha256Hex: 'b'.repeat(64) },
      { pathInZip: 'attachments/a.txt', sha256Hex: 'a'.repeat(64) },
      { pathInZip: 'location.json', sha256Hex: 'c'.repeat(64) },
    ]);

    expect(content.endsWith('\n')).toBe(true);
    expect(content).toBe(
      [
        `SHA256  attachments/a.txt  ${'a'.repeat(64)}`,
        `SHA256  location.json  ${'c'.repeat(64)}`,
        `SHA256  manifest.json  ${'b'.repeat(64)}`,
        '',
      ].join('\n'),
    );
  });

  it('round-trips parsed entries', () => {
    const entries = [
      { pathInZip: 'deviceRecord.json', sha256Hex: 'd'.repeat(64) },
      { pathInZip: 'public_key.asc', sha256Hex: 'e'.repeat(64) },
    ];
    const parsed = parseHashesTxt(buildHashesTxt(entries));
    expect(parsed).toEqual(entries);
  });

  it('rejects malformed lines', () => {
    expect(() => parseHashesTxt('SHA256 only-one-field\n')).toThrow(
      /Malformed hashes.txt line/,
    );
  });
});
