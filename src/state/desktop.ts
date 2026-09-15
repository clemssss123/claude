/**
 * The desktop shell's side of the app.
 *
 * In the browser build none of this exists and every call site falls back to
 * the File System Access API or a download. In the packaged app the preload
 * script puts `window.desktop` in place, and the editor gets native dialogs
 * and a real file path to write back to.
 */

export interface SavedFile {
  path: string;
  name: string;
}

export interface OpenedFile extends SavedFile {
  text: string;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface DesktopBridge {
  platform: string;
  openProject: () => Promise<OpenedFile | null>;
  saveProject: (request: {
    text: string;
    path: string | null;
    suggestedName: string;
    forcePicker: boolean;
  }) => Promise<SavedFile | null>;
  saveFile: (request: {
    data: Uint8Array;
    suggestedName: string;
    filters?: FileFilter[];
  }) => Promise<SavedFile | null>;
  revealFile: (path: string) => Promise<void>;
}

/** The bridge, or null in a browser. */
export function desktop(): DesktopBridge | null {
  const bridge = (window as unknown as { desktop?: DesktopBridge }).desktop;
  return bridge && typeof bridge.saveProject === 'function' ? bridge : null;
}

export function isDesktop(): boolean {
  return desktop() !== null;
}

/** File dialog filters for an exported file, from its extension. */
export function filtersForFilename(filename: string): FileFilter[] {
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  const named: Record<string, string> = {
    mp4: 'MP4 video',
    webm: 'WebM video',
    zip: 'PNG sequence (zip)',
  };
  const filters: FileFilter[] = [];
  if (extension && named[extension]) filters.push({ name: named[extension], extensions: [extension] });
  filters.push({ name: 'All files', extensions: ['*'] });
  return filters;
}
