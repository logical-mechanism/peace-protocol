import { invoke } from '@tauri-apps/api/core';

export interface LibraryItem {
  tokenName: string;
  category: string;
  description?: string;
  suggestedPrice?: number;
  storageLayer?: string;
  imageLink?: string;
  fileExtension?: string;
  seller?: string;
  createdAt?: string;
  decryptedAt: string;
  contentMissing: boolean;
  fileSize?: number;
}

export async function listLibraryItems(): Promise<LibraryItem[]> {
  return invoke<LibraryItem[]>('list_library_items');
}

export async function readLibraryContent(
  tokenName: string,
  category: string
): Promise<Uint8Array> {
  const data = await invoke<number[]>('read_library_content', { tokenName, category });
  return new Uint8Array(data);
}

export async function deleteLibraryItem(
  tokenName: string,
  category: string
): Promise<void> {
  return invoke<void>('delete_library_item', { tokenName, category });
}

export async function readSubtitleFile(
  tokenName: string,
  category: string
): Promise<Uint8Array | null> {
  const data = await invoke<number[] | null>('read_subtitle_file', { tokenName, category });
  return data ? new Uint8Array(data) : null;
}

/** Cached media server port (queried once from Rust, reused thereafter). */
let mediaServerPort: number | null = null;

/** Get the localhost port the media HTTP server is listening on. */
async function getMediaPort(): Promise<number> {
  if (mediaServerPort === null) {
    mediaServerPort = await invoke<number>('get_media_server_port');
  }
  return mediaServerPort;
}

/** Get an HTTP URL for a library content file that GStreamer can stream.
 *  WebKitGTK's GStreamer backend cannot fetch from Tauri custom URI schemes
 *  (asset://, media://), so we serve files via a local HTTP server in Rust
 *  with correct MIME types and range-request support. */
export async function getLibraryContentUrl(
  tokenName: string,
  category: string
): Promise<string> {
  const [path, port] = await Promise.all([
    invoke<string>('get_library_content_path', { tokenName, category }),
    getMediaPort(),
  ]);
  return `http://127.0.0.1:${port}/${encodeURIComponent(path)}`;
}

/** Get an HTTP URL for a library item's subtitle file, if one exists. */
export async function getLibrarySubtitleUrl(
  tokenName: string,
  category: string
): Promise<string | null> {
  const [path, port] = await Promise.all([
    invoke<string | null>('get_library_subtitle_path', { tokenName, category }),
    getMediaPort(),
  ]);
  return path ? `http://127.0.0.1:${port}/${encodeURIComponent(path)}` : null;
}

export interface WaveformResult {
  waveform: number[];
  sampleRate: number;
  durationSecs: number;
  channels: number;
  /** Absolute path to raw PCM file (f32 LE) for FFT visualization. */
  fftPcmPath?: string;
}

/** Build a media server URL for a raw PCM file path returned by Rust. */
export async function getPcmUrl(absolutePath: string): Promise<string> {
  const port = await getMediaPort();
  return `http://127.0.0.1:${port}/${encodeURIComponent(absolutePath)}`;
}

/** Fast low-resolution waveform decode via seeking (48 buckets in <1s).
 *  Used for immediate visual feedback while the full decode runs. */
export async function decodeAudioWaveformFast(
  tokenName: string,
  category: string
): Promise<WaveformResult> {
  return invoke<WaveformResult>('decode_audio_waveform_fast', { tokenName, category });
}

/** Decode an audio file from the library and return waveform data.
 *  Uses symphonia (Rust) so all common formats are supported, unlike
 *  WebKitGTK's OfflineAudioContext which only handles MP3/WAV/OGG. */
export async function decodeAudioWaveform(
  tokenName: string,
  category: string
): Promise<WaveformResult> {
  return invoke<WaveformResult>('decode_audio_waveform', { tokenName, category });
}

export async function openWithSystem(
  tokenName: string,
  category: string
): Promise<void> {
  return invoke<void>('open_with_system', { tokenName, category });
}

export async function exportLibraryContent(
  tokenName: string,
  category: string,
  suggestedFilename: string,
): Promise<string | null> {
  return invoke<string | null>('export_library_content', {
    tokenName, category, suggestedFilename,
  });
}
