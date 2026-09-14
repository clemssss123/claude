import { deserializeProject, serializeProject } from '@/core/project';
import type { Project } from '@/core/types';

/**
 * Saving and restoring projects.
 *
 * Where the File System Access API exists, Save writes back to the file you
 * opened, the way a desktop editor does. Everywhere else it falls back to a
 * download and a file picker. Separately, the project is snapshotted into
 * IndexedDB so a crashed or closed tab can offer the work back.
 */

const DB_NAME = 'keyframe-studio';
const DB_VERSION = 1;
const STORE = 'autosave';
const SNAPSHOT_KEY = 'current';

interface Snapshot {
  savedAt: number;
  json: string;
}

type FileHandle = {
  name: string;
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
  getFile: () => Promise<File>;
};

interface FilePickerWindow {
  showSaveFilePicker?: (options: unknown) => Promise<FileHandle>;
  showOpenFilePicker?: (options: unknown) => Promise<FileHandle[]>;
}

let currentHandle: FileHandle | null = null;
let currentName: string | null = null;

export function currentFileName(): string | null {
  return currentName;
}

export function fileSystemAccessAvailable(): boolean {
  return typeof (window as unknown as FilePickerWindow).showSaveFilePicker === 'function';
}

const PICKER_OPTIONS = {
  suggestedName: 'project.kfs.json',
  types: [{
    description: 'Keyframe Studio project',
    accept: { 'application/json': ['.json'] },
  }],
};

/** Save to the open file, or ask where to put it the first time. */
export async function saveProject(project: Project, forcePicker = false): Promise<string> {
  const picker = window as unknown as FilePickerWindow;
  const json = serializeProject(project);

  if (fileSystemAccessAvailable()) {
    if (forcePicker || !currentHandle) {
      currentHandle = await picker.showSaveFilePicker!({
        ...PICKER_OPTIONS,
        suggestedName: `${slug(project.name)}.kfs.json`,
      });
    }
    const writable = await currentHandle.createWritable();
    await writable.write(json);
    await writable.close();
    currentName = currentHandle.name;
    return currentName;
  }

  return downloadProject(project, json);
}

/** Download fallback for browsers without the File System Access API. */
export function downloadProject(project: Project, json = serializeProject(project)): string {
  const filename = `${slug(project.name)}.kfs.json`;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  currentName = filename;
  return filename;
}

export async function openProject(): Promise<{ project: Project; name: string } | null> {
  const picker = window as unknown as FilePickerWindow;

  if (fileSystemAccessAvailable() && picker.showOpenFilePicker) {
    const [handle] = await picker.showOpenFilePicker({ types: PICKER_OPTIONS.types });
    if (!handle) return null;
    const file = await handle.getFile();
    currentHandle = handle;
    currentName = handle.name;
    return { project: deserializeProject(await file.text()), name: handle.name };
  }

  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        currentHandle = null;
        currentName = file.name;
        resolve({ project: deserializeProject(await file.text()), name: file.name });
      } catch (error) {
        reject(error);
      }
    };
    input.click();
  });
}

function slug(name: string): string {
  return name.replace(/\s+/g, '-').replace(/[^\w.-]/g, '').toLowerCase() || 'project';
}

// -- autosave --------------------------------------------------------------

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    // Private browsing and blocked storage are ordinary conditions here.
    request.onerror = () => resolve(null);
  });
}

export async function writeAutoSave(project: Project): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try {
    const snapshot: Snapshot = { savedAt: Date.now(), json: serializeProject(project) };
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(snapshot, SNAPSHOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}

export async function readAutoSave(): Promise<{ project: Project; savedAt: number } | null> {
  const db = await openDatabase();
  if (!db) return null;
  try {
    const snapshot = await new Promise<Snapshot | undefined>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(SNAPSHOT_KEY);
      request.onsuccess = () => resolve(request.result as Snapshot | undefined);
      request.onerror = () => resolve(undefined);
    });
    if (!snapshot) return null;
    return { project: deserializeProject(snapshot.json), savedAt: snapshot.savedAt };
  } catch {
    // A snapshot from an incompatible build is not worth failing over.
    return null;
  } finally {
    db.close();
  }
}

export async function clearAutoSave(): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(SNAPSHOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}
