/**
 * Drain state for rolling upgrades (F-096).
 *
 * A daemon that is about to be replaced stops accepting new work, lets the
 * requests already in flight finish, and then hands control back to the
 * supervisor. Without the timeout a single stuck request would leave the
 * process draining forever — visibly "up" while refusing all traffic.
 */
export class DrainState {
  constructor({ timeoutMs = 60_000, onTimeout = () => {} } = {}) {
    this.timeoutMs = timeoutMs;
    this.onTimeout = onTimeout;
    this.draining = false;
    this.toVersion = null;
    this.inflight = 0;
    this.startedAt = null;
    this.timedOut = false;
    this._timer = null;
    this._waiters = [];
  }

  isDraining() {
    return this.draining;
  }

  beginDrain(toVersion = null) {
    if (this.draining) return this.snapshot();
    this.draining = true;
    this.toVersion = toVersion || null;
    this.startedAt = Date.now();
    this.timedOut = false;
    this._timer = setTimeout(() => {
      this.timedOut = true;
      this._settle();
      this.onTimeout(this.snapshot());
    }, this.timeoutMs);
    this._timer.unref?.();
    return this.snapshot();
  }

  /** Returns a release function, or null when the daemon is draining. */
  tryTrack() {
    if (this.draining) return null;
    this.inflight += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inflight = Math.max(0, this.inflight - 1);
      if (this.draining && this.inflight === 0) this._settle();
    };
  }

  waitForDrained() {
    if (!this.draining) return Promise.resolve({ timedOut: false });
    if (this.inflight === 0 || this.timedOut) return Promise.resolve({ timedOut: this.timedOut });
    return new Promise((resolve) => this._waiters.push(resolve));
  }

  cancelDrain() {
    this.draining = false;
    this.toVersion = null;
    this.startedAt = null;
    this.timedOut = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._settle();
    return this.snapshot();
  }

  snapshot() {
    return {
      draining: this.draining,
      toVersion: this.toVersion,
      inflight: this.inflight,
      startedAt: this.startedAt,
      timedOut: this.timedOut,
    };
  }

  _settle() {
    const waiters = this._waiters;
    this._waiters = [];
    for (const resolve of waiters) resolve({ timedOut: this.timedOut });
  }
}
