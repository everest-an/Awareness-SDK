/**
 * Supervisor for rolling upgrades (F-096 slice 3).
 *
 * The supervisor owns the daemon child and is the only component allowed to
 * replace it. It persists enough state for `update` and `doctor` to work from
 * another process, and it never kills the old child until a drained, verified
 * replacement is ready to take the port.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { UpdateBackoff, checkForUpdate, installTrialVersion } from '../core/updater.mjs';

export const SUPERVISOR_STATE = 'supervisor.json';

export function supervisorStatePath(projectDir) {
  return path.join(projectDir, '.awareness', SUPERVISOR_STATE);
}

export function readSupervisorState(projectDir) {
  try {
    return JSON.parse(fs.readFileSync(supervisorStatePath(projectDir), 'utf8'));
  } catch {
    return null;
  }
}

export function writeSupervisorState(projectDir, state) {
  const target = supervisorStatePath(projectDir);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, target);
}

function jsonResponse(res, body, status = 200) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function requestJson(method, port, pathname, body = null, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? '' : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method,
        timeout: timeoutMs,
        headers: payload
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
          } catch {
            resolve({ status: res.statusCode, body: null });
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(payload);
  });
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function defaultSpawnChild(binPath, { projectDir, port }) {
  const logPath = path.join(projectDir, '.awareness', 'daemon.log');
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(
    process.execPath,
    [binPath, 'start', '--foreground', '--project', projectDir, '--port', String(port)],
    {
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
      env: { ...process.env },
    },
  );
  fs.closeSync(logFd);
  return child;
}

async function defaultStopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const exited = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 10_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  if (!exited) child.kill('SIGKILL');
}

/**
 * One update attempt. The switch itself is delegated so the supervisor owns
 * process handles while this flow stays testable with fakes.
 */
export async function runUpdateFlow({
  currentVersion,
  checkUpdate,
  installTrial,
  drain,
  waitDrained,
  switchTo,
  backoff,
  updatesDir,
}) {
  const fail = (phase, reason) => {
    backoff.recordFailure(reason);
    return { status: 'failed', phase, reason };
  };

  const check = await checkUpdate({ currentVersion });
  if (check.error) return fail('check', check.error);
  if (!check.available) {
    backoff.recordSuccess();
    return { status: 'up-to-date', latest: check.latest };
  }

  let installed;
  try {
    installed = await installTrial({ version: check.latest, prefixDir: updatesDir });
  } catch (err) {
    return fail('install', String(err?.message || err));
  }

  try {
    await drain(check.latest);
  } catch (err) {
    return fail('drain', `drain_failed: ${err?.message || err}`);
  }

  if (!(await waitDrained())) return fail('drain', 'drain_timeout');

  const switched = await switchTo(installed);
  if (!switched.ok) return fail('switch', switched.reason);

  backoff.recordSuccess();
  return { status: 'updated', version: check.latest, dir: installed.dir };
}

export class Supervisor {
  constructor({
    projectDir,
    port,
    binPath,
    currentVersion,
    autoUpdate = false,
    updateIntervalMs = 300_000,
    drainTimeoutMs = 60_000,
    controlPort = port + 1,
    deps = {},
  }) {
    this.projectDir = projectDir;
    this.port = port;
    this.binPath = binPath;
    this.currentVersion = currentVersion;
    this.autoUpdate = autoUpdate;
    this.updateIntervalMs = updateIntervalMs;
    this.drainTimeoutMs = drainTimeoutMs;
    this.controlPort = controlPort;
    this.now = deps.now || Date.now;
    this.sleep = deps.sleep || defaultSleep;
    this.spawnChild = deps.spawnChild || defaultSpawnChild;
    this.stopChild = deps.stopChild || defaultStopChild;
    this.checkUpdate = deps.checkUpdate || checkForUpdate;
    this.installTrial = deps.installTrial || installTrialVersion;
    this.requestJson = deps.requestJson || requestJson;
    this.backoff = new UpdateBackoff({ now: this.now });
    this.child = null;
    this.controlServer = null;
    this.timer = null;
    this.shuttingDown = false;
    this.updating = false;
    this.lastResult = null;
    this.activeVersion = currentVersion;
    this.activeBin = binPath;
  }

  async start() {
    this.child = this.spawnChild(this.activeBin, {
      projectDir: this.projectDir,
      port: this.port,
    });
    const healthy = await this._waitHealthy(30_000);
    if (!healthy) {
      await this.stopChild(this.child);
      throw new Error('supervisor: initial child did not become healthy');
    }
    await this._listenControl();
    this._persist();
    if (this.autoUpdate) {
      this.timer = setInterval(() => {
        if (!this.shuttingDown && this.backoff.canAttempt(this.now())) this.checkNow();
      }, this.updateIntervalMs);
      this.timer.unref?.();
    }
    return this;
  }

  async stop() {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.controlServer) {
      await new Promise((resolve) => this.controlServer.close(resolve));
      this.controlServer = null;
    }
    await this.stopChild(this.child);
    this.child = null;
    try {
      fs.unlinkSync(supervisorStatePath(this.projectDir));
    } catch {
      /* already gone */
    }
  }

  state() {
    return {
      pid: process.pid,
      childPid: this.child?.pid || null,
      port: this.port,
      controlPort: this.controlPort,
      projectDir: this.projectDir,
      version: this.activeVersion,
      activeBin: this.activeBin,
      autoUpdate: this.autoUpdate,
      updating: this.updating,
      update: { ...this.backoff.state(), lastResult: this.lastResult },
    };
  }

  async checkNow() {
    if (this.updating || this.shuttingDown) return { status: 'busy' };
    this.updating = true;
    try {
      const result = await runUpdateFlow({
        currentVersion: this.activeVersion,
        checkUpdate: this.checkUpdate,
        installTrial: this.installTrial,
        drain: (version) => this._drainChild(version),
        waitDrained: () => this._waitDrained(),
        switchTo: (installed) => this._switchTo(installed),
        backoff: this.backoff,
        updatesDir: path.join(this.projectDir, '.awareness', 'updates'),
      });
      this.lastResult = result;
      this._persist();
      return result;
    } finally {
      this.updating = false;
    }
  }

  async _switchTo(installed) {
    const nextBin = path.join(installed.dir, 'bin', 'awareness-local.mjs');
    const previousBin = this.activeBin;
    await this.stopChild(this.child);
    this.child = null;

    let next;
    try {
      next = this.spawnChild(nextBin, { projectDir: this.projectDir, port: this.port });
    } catch (err) {
      await this._restore(previousBin);
      return { ok: false, reason: `spawn_failed: ${err?.message || err}` };
    }
    this.child = next;
    const healthy = await this._waitHealthy(30_000);
    if (!healthy) {
      await this.stopChild(next);
      this.child = null;
      await this._restore(previousBin);
      return { ok: false, reason: 'health_check_failed' };
    }
    this.activeBin = nextBin;
    this.activeVersion = installed.version;
    return { ok: true };
  }

  async _restore(previousBin) {
    try {
      this.child = this.spawnChild(previousBin, {
        projectDir: this.projectDir,
        port: this.port,
      });
      this.activeBin = previousBin;
      await this._waitHealthy(30_000);
    } catch {
      /* doctor surfaces the failure through the persisted state */
    }
  }

  async _waitHealthy(timeoutMs) {
    const deadline = this.now() + timeoutMs;
    while (this.now() < deadline) {
      try {
        const res = await this.requestJson('GET', this.port, '/healthz', null, 2000);
        if (res.status === 200 && res.body?.status !== 'degraded') return true;
      } catch {
        /* not up yet */
      }
      await this.sleep(500);
    }
    return false;
  }

  async _drainChild(version) {
    const res = await this.requestJson('POST', this.port, '/api/v1/update/drain', {
      toVersion: version,
    });
    if (res.status !== 202) throw new Error(`drain returned ${res.status}`);
    return res.body;
  }

  async _waitDrained() {
    const deadline = this.now() + this.drainTimeoutMs + 5000;
    while (this.now() < deadline) {
      try {
        const res = await this.requestJson('GET', this.port, '/api/v1/update/status', null, 2000);
        const drain = res.body?.drain;
        if (drain && (drain.inflight === 0 || drain.timedOut)) return true;
      } catch {
        return false;
      }
      await this.sleep(500);
    }
    return false;
  }

  async _listenControl() {
    this.controlServer = http.createServer(async (req, res) => {
      const addr = req.socket.remoteAddress;
      const loopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
      if (!loopback) return jsonResponse(res, { error: 'forbidden' }, 403);
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname === '/status' && req.method === 'GET') return jsonResponse(res, this.state());
      if (pathname === '/check' && req.method === 'POST') {
        return jsonResponse(res, await this.checkNow());
      }
      if (pathname === '/shutdown' && req.method === 'POST') {
        jsonResponse(res, { status: 'stopping' });
        setTimeout(() => this.stop().then(() => process.exit(0)), 50);
        return;
      }
      return jsonResponse(res, { error: 'not found' }, 404);
    });
    await new Promise((resolve, reject) => {
      this.controlServer.once('error', reject);
      this.controlServer.listen(this.controlPort, '127.0.0.1', resolve);
    });
    this.controlPort = this.controlServer.address().port;
  }

  _persist() {
    writeSupervisorState(this.projectDir, this.state());
  }
}
