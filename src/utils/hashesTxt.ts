// ============================================================
// GroundPin — hashes.txt Generator
// ============================================================
//
// Format per spec (Section 11):
//   SHA256  <pathInZip>  <lowercaseHexHash>
//
// Rules:
//   - Paths use '/' separator
//   - Sorted in dictionary order
//   - Does NOT include hashes.txt itself
//   - Does NOT include sig.gpg
//   - DOES include public_key.asc
//   - Uses LF line endings
//   - Trailing LF is present
// ============================================================

/** Single hash entry */
export type HashEntry = {
  pathInZip: string;
  sha256Hex: string;
};

/** Build the hashes.txt content from a list of entries.
 *  Entries are sorted by pathInZip (dictionary order),
 *  and formatted as "SHA256  <path>  <hex>\n". */
export function buildHashesTxt(entries: HashEntry[]): string {
  // Sort by path (dictionary order)
  const sorted = [...entries].sort((a, b) =>
    a.pathInZip.localeCompare(b.pathInZip),
  );

  // Build lines
  const lines = sorted.map(
    (e) => `SHA256  ${e.pathInZip}  ${e.sha256Hex.toLowerCase()}`,
  );

  // Join with LF, add trailing LF
  return lines.join('\n') + '\n';
}

/** Validate hashes.txt content format and return parsed entries.
 *  Throws on malformed lines. */
export function parseHashesTxt(content: string): HashEntry[] {
  const lines = content.split('\n');
  const entries: HashEntry[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) {
      throw new Error(`Malformed hashes.txt line: "${trimmed}"`);
    }

    const algorithm = parts[0];
    if (algorithm !== 'SHA256') {
      throw new Error(`Unsupported hash algorithm: ${algorithm}`);
    }

    const pathInZip = parts[1];
    const sha256Hex = parts[2];

    // Basic validation: sha256 hex is 64 chars
    if (!/^[0-9a-fA-F]{64}$/.test(sha256Hex)) {
      throw new Error(`Invalid SHA-256 hex in hashes.txt: "${trimmed}"`);
    }

    // No parent-dir traversal
    if (pathInZip.includes('..')) {
      throw new Error(`Invalid path in hashes.txt: "${pathInZip}"`);
    }

    entries.push({ pathInZip, sha256Hex: sha256Hex.toLowerCase() });
  }

  return entries;
}
