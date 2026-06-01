// ============================================================
// GroundPin — Attachment Store (AsyncStorage)
// ============================================================
//
// Persists AttachmentRecord[] across app restarts.
// Supports: add, delete (with anchor JSON), list all, count.
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AttachmentRecord } from '../types';
import * as NativePackage from '../native/NativePackage';

const STORAGE_KEY = '@GroundPin:attachments';

/** Load all attachment records from persistent storage */
export async function loadAttachments(): Promise<AttachmentRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as AttachmentRecord[];
  } catch {
    return [];
  }
}

/** Save the full attachment list to persistent storage */
export async function saveAttachments(
  attachments: AttachmentRecord[],
): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(attachments));
}

async function deleteAttachmentFiles(attachment: AttachmentRecord): Promise<void> {
  const uris = [attachment.uri, attachment.anchorJsonUri].filter(
    (uri): uri is string => Boolean(uri),
  );
  for (const uri of uris) {
    try {
      await NativePackage.deletePrivateFile(uri);
    } catch {
      // Best effort — storage record is still removed
    }
  }
}

/** Add a new attachment record to the store */
export async function addAttachment(
  attachment: AttachmentRecord,
): Promise<void> {
  const attachments = await loadAttachments();
  attachments.push(attachment);
  await saveAttachments(attachments);
}

/** Delete an attachment and its anchor JSON by ID.
 *  Returns true if the attachment was found and deleted. */
export async function deleteAttachment(id: string): Promise<boolean> {
  const attachments = await loadAttachments();
  const index = attachments.findIndex((a) => a.id === id);
  if (index === -1) {
    return false;
  }
  const [removed] = attachments.splice(index, 1);
  await deleteAttachmentFiles(removed);
  await saveAttachments(attachments);
  return true;
}

/** Get the total count of undeleted attachments */
export async function getAttachmentCount(): Promise<number> {
  const attachments = await loadAttachments();
  return attachments.length;
}

/** Check if an attachment with the given ID exists */
export async function attachmentExists(id: string): Promise<boolean> {
  const attachments = await loadAttachments();
  return attachments.some((a) => a.id === id);
}

/** Remove all attachments and their files from disk (e.g. after successful export). */
export async function removeAllAttachments(): Promise<void> {
  const attachments = await loadAttachments();
  for (const attachment of attachments) {
    await deleteAttachmentFiles(attachment);
  }
  await AsyncStorage.removeItem(STORAGE_KEY);
}

/** Clear all attachments (for testing/reset) */
export async function clearAttachments(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
