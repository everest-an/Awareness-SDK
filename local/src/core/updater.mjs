/**
 * Version checks and retry policy for rolling upgrades (F-096).
 *
 * Pure and injectable: the supervisor owns the process model and persistence,
 * this module owns "is there a newer version?", "should we try now?", and
 * "did the trial install actually produce the version we asked for?".
 */
export const PACKAGE_NAME = '@awareness.market/local';
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
export const DEFAULT_BACKOFF_MS = [60_000, 120_000, 240_000, 480_000, 900_000];

export function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value || '').trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || null,
  };
}

/** -1 when a < b, 0 when equal, 1 when a > b, null when either is invalid. */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease > right.prerelease ? 1 : -1;
}

export function isNewer(candidate, current) {
  return compareVersions(candidate, current) === 1;
}

export async function checkForUpdate({
  currentVersion,
  packageName = PACKAGE_NAME,
  registryUrl = DEFAULT_REGISTRY,
  fetchImpl = fetch,
  timeoutMs = 10_000,
}) {
  const url = `${registryUrl.replace(/\/+$/, '')}/${packageName.replace('/', '%2F')}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (timer.unref) timer.unref();
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      return { available: false, current: currentVersion, latest: null, error: `registry_http_${response.status}` };
    }
    let body;
    try {
      body = await response.json();
    } catch {
      return { available: false, current: currentVersion, latest: null, error: 'bad_json' };
    }
    const latest = body?.['dist-tags']?.latest;
    if (!latest) {
      return { available: false, current: currentVersion, latest: null, error: 'no_latest' };
    }
    if (!parseVersion(latest) || !parseVersion(currentVersion)) {
      return { available: false, current: currentVersion, latest, error: 'bad_version' };
    }
    return {
      available: isNewer(latest, currentVersion),
      current: currentVersion,
      latest,
      error: null,
    };
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'registry_timeout' : 'registry_network';
    return { available: false, current: currentVersion, latest: null, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

export class UpdateBackoff {
  constructor({ delays = DEFAULT_BACKOFF_MS, now = Date.now } = {}) {
    this.delays = delays;
    this.now = now;
    this.attempts = 0;
    this.nextAttemptAt = 0;
    this.lastError = null;
  }

  canAttempt(at = this.now()) {
    return at >= this.nextAttemptAt;
  }

  recordFailure(reason, at = this.now()) {
    const delay = this.delays[Math.min(this.attempts, this.delays.length - 1)];
    this.attempts += 1;
    this.nextAttemptAt = at + delay;
    this.lastError = reason;
    return { attempts: this.attempts, delay, nextAttemptAt: this.nextAttemptAt, reason };
  }

  recordSuccess() {
    this.attempts = 0;
    this.nextAttemptAt = 0;
    this.lastError = null;
  }

  state() {
    return { attempts: this.attempts, nextAttemptAt: this.nextAttemptAt, lastError: this.lastError };
  }

  restore(state = {}) {
    this.attempts = Number(state.attempts) || 0;
    this.nextAttemptAt = Number(state.nextAttemptAt) || 0;
    this.lastError = state.lastError || null;
  }
}

/**
 * Trial-install a version into an isolated prefix and confirm the package on
 * disk is exactly the requested version. The supervisor only switches children
 * after this resolves.
 */
export async function installTrialVersion({
  version,
  prefixDir,
  packageName = PACKAGE_NAME,
  execImpl,
  fsImpl,
  pathImpl,
  now = Date.now,
}) {
  if (!prefixDir) throw new Error('install_failed: missing prefixDir');
  const fs = fsImpl || (await import('node:fs')).default;
  const path = pathImpl || (await import('node:path')).default;
  const run = execImpl || defaultExec;

  try {
    await run('npm', [
      'install',
      '--prefix',
      prefixDir,
      '--no-save',
      '--no-audit',
      '--no-fund',
      `${packageName}@${version}`,
    ]);
  } catch (err) {
    throw new Error(`install_failed: ${err?.message || err}`);
  }

  const packageJson = path.join(prefixDir, 'node_modules', ...packageName.split('/'), 'package.json');
  let installed;
  try {
    installed = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
  } catch {
    throw new Error('verify_failed: package.json missing');
  }
  if (installed.version !== version) {
    throw new Error(`verify_failed: expected ${version}, found ${installed.version}`);
  }
  return { dir: path.dirname(packageJson), version: installed.version, installedAt: now() };
}

function defaultExec(command, args) {
  return new Promise((resolve, reject) => {
    import('node:child_process').then(({ spawn }) => {
      const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
    });
  });
}
