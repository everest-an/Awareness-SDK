/**
 * P2-1 · Parametric broker event hooks.
 *
 * Three hooks, two independent switches (both default OFF):
 *
 *   consolidation_write  — after awareness_record success, write the event
 *                          to the parametric broker. Also, on daemon stop,
 *                          snapshot the broker session to disk and record
 *                          the path in session metadata.
 *
 *   conflict_forget      — when conflict detection (card-evolution's
 *                          supersedeCard) determines a card is replaced,
 *                          broker.forget(old key) then broker.write(new).
 *                          The conflict DECISION stays in this repo
 *                          (card-evolution's findSupersessionCandidate);
 *                          the parametric layer only executes the forget
 *                          + rewrite.
 *
 * Both switches read from daemon config:
 *   config.parametric.consolidation_write (default false)
 *   config.parametric.conflict_forget     (default false)
 *
 * The broker is optional. When absent or either switch is off, every
 * hook is a no-op. All hooks degrade silently — no exception escapes
 * to the caller's code path.
 *
 * Value encoding (key/value for broker.write) is delegated to M1's
 * policy_write via the broker. The SDK only passes the event; M1
 * decides how to encode it. When policy_write is not available (broker
 * lacks the method), we fall back to a simple text key→value binding.
 */

/**
 * Read the parametric hook switches from daemon config.
 * Returns { consolidation_write, conflict_forget }.
 */
export function getParametricSwitches(daemon) {
  try {
    const cfg = daemon?._loadConfig?.();
    const pcfg = cfg?.parametric || {};
    return {
      consolidation_write: pcfg.consolidation_write === true,
      conflict_forget: pcfg.conflict_forget === true,
    };
  } catch {
    return { consolidation_write: false, conflict_forget: false };
  }
}

/**
 * Check whether a broker is attached to the daemon.
 */
function _broker(daemon) {
  return daemon?._parametricBroker || null;
}

/**
 * Determine the active broker session id.
 */
function _sessionId(daemon, fallback) {
  const broker = _broker(daemon);
  if (!broker) return null;
  if (typeof broker.getActiveSessionId === 'function') {
    return broker.getActiveSessionId();
  }
  return fallback || 'default';
}

// ------------------------------------------------------------------
// Hook 1: post-record write
// ------------------------------------------------------------------

/**
 * Called after awareness_record (remember action) succeeds.
 *
 * If consolidation_write is ON and a broker is attached, writes the
 * event to the broker. The broker's policy_write (M1) handles category
 * filtering and value encoding; the SDK only passes the event.
 *
 * @param {object} daemon
 * @param {object} event - { id, content, title, type, session_id, source, tags }
 */
export async function onRecordSuccess(daemon, event) {
  const { consolidation_write } = getParametricSwitches(daemon);
  if (!consolidation_write) return;

  const broker = _broker(daemon);
  if (!broker) return;

  const sessionId = _sessionId(daemon, event?.session_id);
  if (!sessionId) return;

  try {
    // Delegate value encoding to M1's policy_write if available.
    // The broker decides which categories to accept and how to encode
    // the value. SDK only passes the event — no policy logic here.
    if (typeof broker.policyWrite === 'function') {
      await broker.policyWrite(sessionId, event);
    } else if (typeof broker.write === 'function') {
      // Fallback: simple text key→value binding.
      const key = event?.title || event?.id || String(event?.content || '').slice(0, 80);
      const value = event?.content || '';
      if (key && value) {
        await broker.write(sessionId, key, value);
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.warn('[parametric-hooks] onRecordSuccess failed:', err.message);
  }
}

// ------------------------------------------------------------------
// Hook 2: conflict forget + rewrite
// ------------------------------------------------------------------

/**
 * Called when conflict detection determines a card is superseded.
 *
 * If conflict_forget is ON and a broker is attached, forgets the old
 * binding then writes the new one. The conflict DECISION was already
 * made by card-evolution's findSupersessionCandidate — this hook only
 * executes the parametric-layer consequence.
 *
 * @param {object} daemon
 * @param {object} oldCard - { id, title, summary, category }
 * @param {object} newCard - { id, title, summary, category }
 */
export async function onConflictSupersede(daemon, oldCard, newCard) {
  const { conflict_forget } = getParametricSwitches(daemon);
  if (!conflict_forget) return;

  const broker = _broker(daemon);
  if (!broker) return;

  const sessionId = _sessionId(daemon);
  if (!sessionId) return;

  try {
    // Forget the old binding first.
    const oldKey = oldCard?.title || oldCard?.id;
    if (oldKey && typeof broker.forget === 'function') {
      await broker.forget(sessionId, oldKey);
    }

    // Then write the new binding.
    if (typeof broker.policyWrite === 'function') {
      await broker.policyWrite(sessionId, {
        id: newCard?.id,
        content: newCard?.summary || newCard?.title || '',
        title: newCard?.title || '',
        type: newCard?.category || 'knowledge_card',
      });
    } else if (typeof broker.write === 'function') {
      const newKey = newCard?.title || newCard?.id;
      const newValue = newCard?.summary || newCard?.title || '';
      if (newKey && newValue) {
        await broker.write(sessionId, newKey, newValue);
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.warn('[parametric-hooks] onConflictSupersede failed:', err.message);
  }
}

// ------------------------------------------------------------------
// Hook 3: session-end snapshot
// ------------------------------------------------------------------

/**
 * Called when the daemon stops (session end).
 *
 * If consolidation_write is ON and a broker is attached, snapshots
 * the broker session to disk and records the path in session metadata.
 *
 * @param {object} daemon
 * @returns {Promise<string|null>} snapshot file path, or null
 */
export async function onSessionEnd(daemon) {
  const { consolidation_write } = getParametricSwitches(daemon);
  if (!consolidation_write) return null;

  const broker = _broker(daemon);
  if (!broker) return null;

  const sessionId = _sessionId(daemon);
  if (!sessionId) return null;

  try {
    if (typeof broker.snapshot !== 'function') return null;
    const snapshot = await broker.snapshot(sessionId);
    if (!snapshot) return null;

    // Persist the snapshot to the .awareness directory.
    const fs = await import('fs');
    const path = await import('path');
    const snapshotDir = path.join(daemon.awarenessDir, 'parametric-snapshots');
    if (!fs.existsSync(snapshotDir)) {
      fs.mkdirSync(snapshotDir, { recursive: true });
    }
    const snapshotPath = path.join(snapshotDir, `${sessionId}.json`);
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

    // Record the path in session metadata (F-075: real store on daemon).
    if (typeof daemon.setSessionMetadata === 'function') {
      daemon.setSessionMetadata(sessionId, 'parametric_snapshot_path', snapshotPath);
    }

    if (process.env.DEBUG) console.log('[parametric-hooks] snapshot saved:', snapshotPath);
    return snapshotPath;
  } catch (err) {
    if (process.env.DEBUG) console.warn('[parametric-hooks] onSessionEnd failed:', err.message);
    return null;
  }
}
