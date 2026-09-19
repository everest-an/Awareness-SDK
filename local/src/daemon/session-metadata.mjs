/**
 * session-metadata.mjs — P2-1 · minimal session→metadata store.
 *
 * Why: parametric-hooks' session-end snapshot writes the snapshot file
 * path into "session metadata" so a later migration (P2-2) can locate
 * the parametric snapshot for a given session. Before this module the
 * hook's `typeof daemon._setSessionMetadata === 'function'` guard
 * silently no-op'd — the path was recorded nowhere.
 *
 * Design: one JSON file per workspace (`<awarenessDir>/session-metadata.json`),
 * shape `{ [sessionId]: { [key]: value } }`. Writes are rare (once per
 * session end) and tiny, so a whole-file atomic write (tmp + rename) is
 * sufficient — no growth concern at daemon scale.
 *
 * Corruption policy: an unreadable/corrupt file is treated as empty
 * (logged at DEBUG) and overwritten on next save — this store is a
 * pointer aid, never a source of truth; the snapshot files themselves
 * carry the state.
 */

import fs from 'node:fs';
import path from 'node:path';

const FILENAME = 'session-metadata.json';

export function metadataFilePath(awarenessDir) {
  return path.join(awarenessDir, FILENAME);
}

export function loadSessionMetadata(awarenessDir) {
  const file = metadataFilePath(awarenessDir);
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch (err) {
    if (err.code !== 'ENOENT' && process.env.DEBUG) {
      console.warn('[session-metadata] load failed, treating as empty:', err.message);
    }
    return {};
  }
}

export function saveSessionMetadata(awarenessDir, metadata) {
  const file = metadataFilePath(awarenessDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(metadata, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

export function setSessionMetadata(metadata, sessionId, key, value) {
  if (!metadata[sessionId] || typeof metadata[sessionId] !== 'object') {
    metadata[sessionId] = {};
  }
  metadata[sessionId][key] = value;
}

export function getSessionMetadata(metadata, sessionId) {
  const entry = metadata[sessionId];
  return entry && typeof entry === 'object' ? { ...entry } : null;
}
