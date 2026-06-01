// ============================================================
// GroundPin — ID Generator
// ============================================================
// React Native Android has no crypto.getRandomValues; avoid uuid package.

function randomHexByte(): number {
  return Math.floor(Math.random() * 256);
}

/** 4-character short ID for filenames (hex chars only) */
export function shortId(): string {
  return Array.from({ length: 2 }, () => randomHexByte().toString(16).padStart(2, '0')).join('');
}

/** RFC 4122 v4-style UUID (non-cryptographic; sufficient for local package IDs) */
export function generateId(): string {
  const bytes = Array.from({ length: 16 }, () => randomHexByte());
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
