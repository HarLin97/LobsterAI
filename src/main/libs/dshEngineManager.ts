// Manages the bundled DeepSeek Harness (dsh) runtime as a child process:
// resolve the vendored runtime, spawn `web` on a loopback port, poll for
// readiness, and stop it with the app. Mirrors the OpenClaw engine manager's
// spawn split (utilityProcess on macOS/Linux, ELECTRON_RUN_AS_NODE
// child_process on Windows) at skeleton scale; config sync, downloads, and
// crash self-healing land with the kit integration.

import { ChildProcess,spawn } from 'child_process';
import { app, utilityProcess } from 'electron';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';

import {
  DSH_STATE_DIR_NAME,
  DshEngineErrorCode,
  DshEnginePhase,
  DshInstallProgressState,
  DshInstallStage,
} from '../../shared/dshEngine/constants';
import { DshManagedSettings, writeDshManagedSettings } from './dshConfigSync';
import {
  buildDshSpawnEnv,
  buildDshWebArgs,
  DSH_NODE_EXEC_ARGV,
  DSH_RUNTIME_ENTRY_RELPATH,
  dshInstallPercent,
  DshRuntimeBuildInfo,
  parseDshRuntimeBuildInfo,
  resolveDshRuntimeCandidates,
  resolveDshWorkingDirectory,
  shouldPublishInstallProgress,
  validateDshRuntimeLayout,
} from './dshRuntime';
import {
  DshInstallProgress,
  installDshRuntime,
  resolveDshArtifactFromConfig,
  resolveNewestInstalledDshRuntime,
} from './dshRuntimeInstaller';

// The pinned version and the per-target archive descriptors travel inside the
// app, so the digest we verify against is one we shipped rather than one
// fetched from the same host as the archive.
//
// Read through app.getAppPath() rather than a path relative to this file: the
// main process ships as one bundle (dist-electron/main.js), where a relative
// `require('../../../package.json')` lands outside the app entirely. That miss
// is silent — every target reads as unconfigured, so a packaged app never
// downloads a runtime and the feature dies with "No runtime artifact
// configured". getAppPath() is the app root in dev and the asar root when
// packaged, and package.json sits at both.
interface DshPackageMeta {
  version?: string;
  runtimes?: unknown;
}

let dshPackageMetaCache: DshPackageMeta | null = null;

function readDshPackageMeta(): DshPackageMeta {
  if (dshPackageMetaCache) return dshPackageMetaCache;
  let meta: DshPackageMeta = {};
  try {
    const raw = fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8');
    meta = (JSON.parse(raw) as { dsh?: DshPackageMeta }).dsh ?? {};
  } catch (error) {
    console.warn('[DSH] Could not read the pinned runtime metadata from package.json', error);
  }
  dshPackageMetaCache = meta;
  return meta;
}

function resolveHostDshTargetId(): string {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  if (process.platform === 'win32') return 'win-x64';
  return 'linux-x64';
}

// A first start on Windows pays for the whole runtime tree being read (and
// virus-scanned) once: measured 74s cold on a Win11 dev box against 2.5s warm.
// A 60s budget turned that into a spurious "engine failed to start" that a
// second click then fixed, so the cap is for a wedged child, not a slow one —
// a child that dies is caught by the liveness check, not by this.
const READY_TIMEOUT_MS = 180_000;
const READY_POLL_INTERVAL_MS = 250;
// dsh starts listening before its plugin tree finishes loading, so a boot
// failure answers the first probe with 200 and exits ~50ms later. Ready on that
// first 200 opens the workbench onto a dead port: a blank window whose only
// symptom is ERR_CONNECTION_REFUSED in its devtools. Re-probe after this settle
// so a runtime that dies during boot is reported as a failure instead.
const READY_SETTLE_MS = 750;
const READY_PROGRESS_LOG_INTERVAL_MS = 15_000;
const STOP_GRACE_MS = 5_000;
const LOG_RING_MAX_LINES = 400;

export interface DshResolvedRuntime {
  root: string;
  entry: string;
  buildInfo: DshRuntimeBuildInfo | null;
}

export interface DshEngineState {
  phase: DshEnginePhase;
  port: number | null;
  version: string | null;
  errorCode: DshEngineErrorCode | null;
  /**
   * False when a conflicting dsh writer forced this run onto the isolated
   * session store, so the workbench shows its own history instead of the
   * machine's shared one.
   */
  sessionStoreShared: boolean;
  /**
   * Non-null only while the runtime is being fetched and unpacked, which is a
   * ~40s one-time cost the settings card renders as progress.
   */
  install: DshInstallProgressState | null;
}

type DshChild = ChildProcess | Electron.UtilityProcess;

export class DshEngineManager {
  private child: DshChild | null = null;
  private generation = 0;
  private state: DshEngineState = {
    phase: DshEnginePhase.Stopped,
    port: null,
    version: null,
    errorCode: null,
    sessionStoreShared: true,
    install: null,
  };
  private readonly logRing: string[] = [];
  private listeners = new Set<(state: DshEngineState) => void>();
  private quitHookInstalled = false;
  private startPromise: Promise<DshEngineState> | null = null;
  private managedSettingsSource: (() => DshManagedSettings | null) | null = null;
  private workingDirectorySource: (() => string) | null = null;
  private sharedHomeLock: { claim: (port: number) => void; release: () => void } | null = null;
  private homeDirectorySource: (() => string | null) | null = null;

  // DSH_HOME for the child. The kit points this at the machine's dsh home so
  // plugins, credentials, and presets match a standalone install; returning
  // null falls back to our private home (used when another writer holds it).
  setHomeDirectorySource(source: (() => string | null) | null): void {
    this.homeDirectorySource = source;
  }

  // Claimed just before the child spawns and released when it stops, so a
  // second LobsterAI instance can see that the shared session store is taken.
  setSharedHomeLock(lock: { claim: (port: number) => void; release: () => void } | null): void {
    this.sharedHomeLock = lock;
    this.setState({ sessionStoreShared: lock !== null });
  }

  // The child's cwd becomes the workbench's default session directory and the
  // root for project-level skills. Left at the runtime install directory it
  // would put new sessions outside every workspace and point a
  // workspace-write agent at our own vendored runtime.
  setWorkingDirectorySource(source: (() => string) | null): void {
    this.workingDirectorySource = source;
  }

  private resolveWorkingDirectory(fallback: string): string {
    return resolveDshWorkingDirectory([this.workingDirectorySource?.(), app.getPath('home')], isExistingDirectory, fallback);
  }

  // The kit integration registers a source that renders LobsterAI providers
  // into dsh settings (see dshConfigSync). It runs on every start so the child
  // always boots against current provider config, with keys passed via env.
  setManagedSettingsSource(source: (() => DshManagedSettings | null) | null): void {
    this.managedSettingsSource = source;
  }

  getState(): DshEngineState {
    return { ...this.state };
  }

  onStateChange(listener: (state: DshEngineState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getWebUrl(): string | null {
    return this.state.phase === DshEnginePhase.Ready && this.state.port ? `http://127.0.0.1:${this.state.port}` : null;
  }

  getRecentLogs(): string[] {
    return [...this.logRing];
  }

  // Kit-installed runtimes (downloaded archives) live under userData and win
  // over the vendored/bundled copy so upgrades don't require an app release.
  getRuntimeInstallBaseDir(): string {
    return path.join(app.getPath('userData'), 'dsh-runtime');
  }

  // Downloads and installs the pinned runtime when it is not present yet.
  // Resolves the installed root, or null when the app carries no artifact for
  // this platform (dev builds read vendor/dsh-runtime instead). Progress is
  // published on the engine state so the settings card can show it.
  async ensureRuntimeInstalled(): Promise<string | null> {
    const present = this.resolveRuntime();
    if (present) return present.root;

    const meta = readDshPackageMeta();
    const artifact = resolveDshArtifactFromConfig(meta.runtimes ?? null, resolveHostDshTargetId(), meta.version ?? '');
    if (!artifact) {
      console.warn(`[DSH] No runtime artifact configured for ${resolveHostDshTargetId()}`);
      return null;
    }
    console.log(`[DSH] Installing runtime ${artifact.version} for ${artifact.target}`);
    this.setState({
      phase: DshEnginePhase.Installing,
      errorCode: null,
      install: { stage: DshInstallStage.Manifest, receivedBytes: 0, totalBytes: artifact.size },
    });
    try {
      const result = await installDshRuntime({
        artifact,
        baseDir: this.getRuntimeInstallBaseDir(),
        expectedTarget: artifact.target,
        onProgress: (progress) => this.publishInstallProgress(progress),
      });
      console.log(`[DSH] Runtime ${result.version} ready at ${result.root}`);
      this.setState({ phase: DshEnginePhase.Stopped, install: null });
      return result.root;
    } catch (error) {
      // The caller reports the message; the state carries the red dot so the
      // card does not sit on "installing" after the install gave up.
      this.setState({ phase: DshEnginePhase.Failed, errorCode: DshEngineErrorCode.InstallFailed, install: null });
      throw error;
    }
  }

  private publishInstallProgress(progress: DshInstallProgress): void {
    const previous = this.state.install;
    const next: DshInstallProgressState =
      progress.stage === DshInstallStage.Download
        ? { stage: progress.stage, receivedBytes: progress.receivedBytes, totalBytes: progress.totalBytes }
        : { stage: progress.stage, receivedBytes: previous?.receivedBytes ?? 0, totalBytes: previous?.totalBytes ?? 0 };
    if (!shouldPublishInstallProgress(previous, next)) return;
    this.setState({ install: next });
    if (next.stage !== DshInstallStage.Download) {
      console.log(`[DSH] Runtime install: ${next.stage}`);
      return;
    }
    const percent = dshInstallPercent(next);
    if (percent % 25 === 0) console.log(`[DSH] Downloading runtime ${percent}%`);
  }

  resolveRuntime(): DshResolvedRuntime | null {
    const installed = resolveNewestInstalledDshRuntime(this.getRuntimeInstallBaseDir());
    if (installed) {
      const layout = validateDshRuntimeLayout(installed.root, fs.existsSync, path.join);
      if (layout.ok) {
        return {
          root: installed.root,
          entry: path.join(installed.root, ...DSH_RUNTIME_ENTRY_RELPATH.split('/')),
          buildInfo: readBuildInfo(installed.root),
        };
      }
    }
    const candidates = resolveDshRuntimeCandidates({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      cwd: process.cwd(),
      joinPath: path.join,
    });
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      // Resolve the vendor/dsh-runtime/current symlink; dsh path checks reject
      // paths that traverse unresolved links.
      const root = fs.realpathSync(candidate);
      const layout = validateDshRuntimeLayout(root, fs.existsSync, path.join);
      if (!layout.ok) {
        console.warn(`[DSH] Runtime at ${root} is incomplete, missing: ${layout.missing.join(', ')}`);
        continue;
      }
      return { root, entry: path.join(root, ...DSH_RUNTIME_ENTRY_RELPATH.split('/')), buildInfo: readBuildInfo(root) };
    }
    return null;
  }

  getDshHomeDir(): string {
    return this.homeDirectorySource?.() ?? this.getPrivateDshHomeDir();
  }

  getPrivateDshHomeDir(): string {
    return path.join(app.getPath('userData'), DSH_STATE_DIR_NAME);
  }

  async start(): Promise<DshEngineState> {
    if (this.state.phase === DshEnginePhase.Ready && this.child) return this.getState();
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.doStart().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.generation += 1;
    this.child = null;
    if (child) {
      await this.terminateChild(child);
      this.sharedHomeLock?.release();
    }
    if (this.state.phase !== DshEnginePhase.Failed && this.state.phase !== DshEnginePhase.NotInstalled) {
      this.setState({ phase: DshEnginePhase.Stopped, port: null, errorCode: null });
    }
  }

  private async doStart(): Promise<DshEngineState> {
    // A start can be requested before Electron finishes booting (an early MCP
    // tool call, an autostart hook): utilityProcess.fork and app.getPath both
    // throw until the app is ready, so wait rather than fail the request.
    if (!app.isReady()) {
      await app.whenReady();
    }
    await this.stop();
    const generation = this.generation;

    const runtime = this.resolveRuntime();
    if (!runtime) {
      console.error('[DSH] No usable runtime found. Run `npm run dsh:runtime:host` in dev.');
      this.setState({ phase: DshEnginePhase.NotInstalled, port: null, errorCode: DshEngineErrorCode.RuntimeMissing });
      return this.getState();
    }
    this.setState({
      phase: DshEnginePhase.Starting,
      port: null,
      version: runtime.buildInfo?.dshVersion ?? null,
      errorCode: null,
    });

    const dshHome = this.getDshHomeDir();
    fs.mkdirSync(dshHome, { recursive: true });

    let managedEnv: Record<string, string> = {};
    if (this.managedSettingsSource) {
      try {
        const managed = this.managedSettingsSource();
        if (managed) {
          const { warnings } = await writeDshManagedSettings(dshHome, managed);
          for (const warning of warnings) console.warn(`[DSH] Settings merge: ${warning}`);
          managedEnv = managed.envVars;
        }
      } catch (error) {
        console.error('[DSH] Failed to sync managed settings; starting without them', error);
      }
    }

    const port = await allocateLoopbackPort();
    const env = buildDshSpawnEnv({
      baseEnv: { ...process.env, ...managedEnv },
      dshHome,
      timeZone: resolveTimeZone(),
    });
    const args = buildDshWebArgs(runtime.entry, port);

    const workingDirectory = this.resolveWorkingDirectory(runtime.root);
    console.log(
      `[DSH] Starting runtime ${runtime.buildInfo?.dshVersion ?? 'unknown'} on 127.0.0.1:${port} (cwd=${workingDirectory})`
    );
    let child: DshChild;
    try {
      if (process.platform === 'win32') {
        child = spawn(process.execPath, [...DSH_NODE_EXEC_ARGV, ...args], {
          cwd: workingDirectory,
          env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } else {
        child = utilityProcess.fork(args[0], args.slice(1), {
          cwd: workingDirectory,
          execArgv: [...DSH_NODE_EXEC_ARGV],
          env,
          stdio: 'pipe',
          serviceName: 'DSH Runtime',
        });
      }
    } catch (error) {
      console.error('[DSH] Failed to spawn runtime', error);
      this.setState({ phase: DshEnginePhase.Failed, port: null, errorCode: DshEngineErrorCode.SpawnFailed });
      return this.getState();
    }

    this.child = child;
    this.sharedHomeLock?.claim(port);
    this.installQuitHook();
    this.wireChildStreams(child, generation);

    const readyError = await this.waitForReady(port, generation);
    if (this.generation !== generation) return this.getState();
    if (readyError) {
      // A child that already exited dumped its output from the exit handler; a
      // wedged one is still running and has not, so carry the tail here.
      const tail = this.child ? `. Recent output:\n${this.logRing.slice(-20).join('\n')}` : '';
      console.error(`[DSH] Runtime did not become ready: ${readyError}${tail}`);
      await this.stop();
      this.setState({ phase: DshEnginePhase.Failed, port: null, errorCode: readyError });
      return this.getState();
    }

    console.log(`[DSH] Ready at http://127.0.0.1:${port}`);
    this.setState({ phase: DshEnginePhase.Ready, port, errorCode: null });
    return this.getState();
  }

  private wireChildStreams(child: DshChild, generation: number): void {
    const append = (chunk: unknown) => {
      const lines = String(chunk).split(/\r?\n/).filter((line) => line.length > 0);
      this.logRing.push(...lines);
      if (this.logRing.length > LOG_RING_MAX_LINES) {
        this.logRing.splice(0, this.logRing.length - LOG_RING_MAX_LINES);
      }
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('exit', (code: number | null) => {
      if (this.generation !== generation) return;
      this.child = null;
      // A boot failure prints its stack on the child's own streams and nowhere
      // else, and the generation guard above already filtered out the stops we
      // asked for, so any exit reaching here owes the main log its output.
      if (code !== 0) {
        console.error(`[DSH] Runtime exited (code=${code ?? 'null'}). Recent output:\n${this.logRing.slice(-40).join('\n')}`);
      }
      if (this.state.phase === DshEnginePhase.Ready) {
        console.warn(`[DSH] Runtime exited unexpectedly (code=${code ?? 'null'})`);
        this.setState({ phase: DshEnginePhase.Stopped, port: null, errorCode: null });
      }
    });
  }

  // Resolves null once the web server answers and keeps answering, or the error
  // code on failure.
  private async waitForReady(port: number, generation: number): Promise<DshEngineErrorCode | null> {
    const startedAt = Date.now();
    const deadline = startedAt + READY_TIMEOUT_MS;
    let nextProgressLog = startedAt + READY_PROGRESS_LOG_INTERVAL_MS;
    while (Date.now() < deadline) {
      if (this.generation !== generation || !this.child) return DshEngineErrorCode.CrashedEarly;
      const status = await probeHttpStatus(port);
      if (status === 200) return this.confirmStillServing(port, generation);
      if (Date.now() >= nextProgressLog) {
        console.log(`[DSH] Still waiting for the runtime on 127.0.0.1:${port} (${Math.round((Date.now() - startedAt) / 1000)}s)`);
        nextProgressLog = Date.now() + READY_PROGRESS_LOG_INTERVAL_MS;
      }
      await delay(READY_POLL_INTERVAL_MS);
    }
    return DshEngineErrorCode.ReadyTimeout;
  }

  // See READY_SETTLE_MS: a first 200 only proves the HTTP server bound, not that
  // the runtime survived boot.
  private async confirmStillServing(port: number, generation: number): Promise<DshEngineErrorCode | null> {
    await delay(READY_SETTLE_MS);
    if (this.generation !== generation || !this.child) return DshEngineErrorCode.CrashedEarly;
    return (await probeHttpStatus(port)) === 200 ? null : DshEngineErrorCode.CrashedEarly;
  }

  private async terminateChild(child: DshChild): Promise<void> {
    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    });
    try {
      child.kill();
    } catch {
      return;
    }
    const timedOut = await Promise.race([exited.then(() => false), delay(STOP_GRACE_MS).then(() => true)]);
    if (timedOut) {
      try {
        if ('pid' in child && typeof child.pid === 'number' && 'exitCode' in child) {
          (child as ChildProcess).kill('SIGKILL');
        } else {
          child.kill();
        }
      } catch {
        // Already gone.
      }
      await Promise.race([exited, delay(1_000)]);
    }
  }

  private installQuitHook(): void {
    if (this.quitHookInstalled) return;
    this.quitHookInstalled = true;
    app.on('will-quit', () => {
      const child = this.child;
      this.generation += 1;
      this.child = null;
      if (child) {
        try {
          child.kill();
        } catch {
          // Already gone.
        }
      }
      this.sharedHomeLock?.release();
    });
  }

  private setState(patch: Partial<DshEngineState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      try {
        listener(this.getState());
      } catch (error) {
        console.error('[DSH] State listener failed', error);
      }
    }
  }
}

function isExistingDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function readBuildInfo(runtimeRoot: string): DshRuntimeBuildInfo | null {
  const buildInfoPath = path.join(runtimeRoot, 'runtime-build-info.json');
  if (!fs.existsSync(buildInfoPath)) return null;
  return parseDshRuntimeBuildInfo(fs.readFileSync(buildInfoPath, 'utf8'));
}

function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Could not allocate a loopback port')));
      }
    });
  });
}

function probeHttpStatus(port: number): Promise<number> {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2_000 }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', () => resolve(0));
  });
}

function resolveTimeZone(): string | undefined {
  if (process.env.TZ) return undefined;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let dshEngineManagerInstance: DshEngineManager | null = null;

export function getDshEngineManager(): DshEngineManager {
  if (!dshEngineManagerInstance) {
    dshEngineManagerInstance = new DshEngineManager();
  }
  return dshEngineManagerInstance;
}
