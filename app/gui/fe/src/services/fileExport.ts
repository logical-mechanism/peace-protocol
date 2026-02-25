import { invoke } from '@tauri-apps/api/core';

/**
 * Export text content to a file via native save dialog.
 * Returns the saved path, or null if the user cancelled.
 */
export async function exportTextFile(
  content: string,
  suggestedFilename: string,
): Promise<string | null> {
  return invoke<string | null>('export_text_file', { content, suggestedFilename });
}
