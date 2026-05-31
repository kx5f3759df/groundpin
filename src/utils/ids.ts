// ============================================================
// GroundPin — ID Generator
// ============================================================

import { v4 as uuidv4 } from 'uuid';

/** 4-character short ID for filenames (hex chars only) */
export function shortId(): string {
  return uuidv4().replace(/-/g, '').slice(0, 4);
}

/** Full UUID */
export function generateId(): string {
  return uuidv4();
}
