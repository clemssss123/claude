import { desktop } from './desktop';
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
const DB_VERSION = 2;
const STORE = 'autosave';
const FOOTAGE_STORE = 'footage';
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
/** Where the open project lives on disk, in the desktop app. */
let currentPath: string | null = null;

export function currentFilePath(): string | null {
  return currentPath;
}

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

  // The desktop app writes straight to the path it opened, and only asks
  // where to put a project that has never been saved.
  const bridge = desktop();
  if (bridge) {
    const saved = await bridge.saveProject({
      text: json,
      path: currentPath,
      suggestedName: `${slug(project.name)}.kfs.json`,
      forcePicker,
    });
    if (!saved) throw new DOMException('Save cancelled.', 'AbortError');
    currentPath = saved.path;
    currentName = saved.name;
    return saved.name;
  }

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

  const bridge = desktop();
  if (bridge) {
    const opened = await bridge.openProject();
    if (!opened) return null;
    currentHandle = null;
    currentPath = opened.path;
    currentName = opened.name;
    return { project: deserializeProject(opened.text), name: opened.name };
  }

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
        currentPath = null;
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
      if (!request.result.objectStoreNames.contains(FOOTAGE_STORE)) {
        request.result.createObjectStore(FOOTAGE_STORE);
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

// -- footage blobs ---------------------------------------------------------

/**
 * Imported media is kept here rather than in the project file, so a project
 * stays small and text-only while its footage survives a reload.
 */
export async function writeFootage(id: string, blob: Blob): Promise<void> {
  const db = await openDatabase();
  if (!db) throw new Error('This browser will not store imported footage.');
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FOOTAGE_STORE, 'readwrite');
      tx.objectStore(FOOTAGE_STORE).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not store the footage.'));
    });
  } finally {
    db.close();
  }
}

export async function readFootage(id: string): Promise<Blob | null> {
  const db = await openDatabase();
  if (!db) return null;
  try {
    return await new Promise<Blob | null>((resolve) => {
      const tx = db.transaction(FOOTAGE_STORE, 'readonly');
      const request = tx.objectStore(FOOTAGE_STORE).get(id);
      request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
      request.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

export async function deleteFootage(id: string): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(FOOTAGE_STORE, 'readwrite');
      tx.objectStore(FOOTAGE_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}

/** Which of these assets actually have their bytes in this browser. */
export async function presentFootageIds(ids: string[]): Promise<Set<string>> {
  const db = await openDatabase();
  if (!db) return new Set();
  try {
    const present = new Set<string>();
    await Promise.all(ids.map((id) => new Promise<void>((resolve) => {
      const tx = db.transaction(FOOTAGE_STORE, 'readonly');
      const request = tx.objectStore(FOOTAGE_STORE).getKey(id);
      request.onsuccess = () => {
        if (request.result !== undefined) present.add(id);
        resolve();
      };
      request.onerror = () => resolve();
    })));
    return present;
  } finally {
    db.close();
  }
}
