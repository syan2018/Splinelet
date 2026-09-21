const { createHash, randomUUID } = require('node:crypto');
const {
  createWriteStream,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} = require('node:fs');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { extname, relative, resolve, sep } = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');

const DEFAULT_PORT = 4179;
const DEFAULT_INSPECTOR_PORT = 9230;
const DEFAULT_TIMEOUT_MS = 45_000;
const ROOT = resolve(__dirname, '../../../..');
const BROWSER_DIRECTORY = resolve(ROOT, 'scripts/tests/browser');
const OUTPUT_ROOT = resolve(ROOT, 'outputs/v4-qa');
const WEB_CONFIG = resolve(ROOT, 'dist/server/wrangler.json');
const DESKTOP_ROOT = resolve(ROOT, 'src-tauri/target/frontend');

const fixture = (kind, path, exportName) => ({ kind, path, exportName });

// All browser modules are listed here deliberately. discoverLegacyModules() makes
// a new module an explicit runner decision instead of an unreported skip.
const legacyCases = [
  {
    name: 'vector-transform',
    module: 'test-vector-transform.cjs',
    adapter: 'page',
  },
  {
    name: 'agent-spline-authoring',
    module: 'test-agent-spline-authoring.cjs',
    adapter: 'page-output',
  },
  {
    name: 'crown-closures',
    module: 'test-crown-closures-browser.cjs',
    adapter: 'page-fixture',
    fixture: fixture('file', 'scripts/tests/fixtures/surface-lineage.json'),
  },
  {
    name: 'endpoint-snapping',
    module: 'test-endpoint-snapping.cjs',
    adapter: 'page-output',
  },
  {
    name: 'hair-partition',
    module: 'test-hair-partition-browser.cjs',
    adapter: 'page-fixture',
    fixture: fixture('json', 'scripts/tests/fixtures/hair-partition.json'),
  },
  {
    name: 'live-surfaces',
    module: 'test-live-surfaces-browser.cjs',
    adapter: 'page-fixture',
    fixture: fixture('spl', 'public/sandrone-example.spl'),
  },
  {
    name: 'modifiers',
    module: 'test-modifiers-browser.cjs',
    adapter: 'page-fixture',
    fixture: fixture('file', 'public/sandrone-example.spl'),
  },
  {
    name: 'object-move-pipeline',
    module: 'test-object-move-pipeline.cjs',
    adapter: 'page-output',
  },
  {
    name: 'object-move',
    module: 'test-object-move-browser.cjs',
    adapter: 'page',
  },
  {
    name: 'pointer-lifecycle',
    module: 'test-pointer-lifecycle.cjs',
    adapter: 'page',
  },
  {
    name: 'property-navigation',
    module: 'test-property-navigation.cjs',
    adapter: 'page-fixture',
    fixture: fixture('json', 'scripts/tests/fixtures/shoulder-region.json'),
  },
  {
    name: 'restore-race',
    module: 'test-restore-race.cjs',
    adapter: 'browser-url-fixture',
    fixture: fixture('spl', 'public/sandrone-example.spl'),
  },
  { name: 'saving', module: 'test-saving-browser.cjs', adapter: 'page' },
  {
    name: 'selection-scope',
    module: 'test-selection-scope-browser.cjs',
    adapter: 'page-fixture',
    fixture: fixture('json', 'scripts/tests/fixtures/shoulder-region.json'),
  },
  {
    name: 'spline-endpoints',
    module: 'test-spline-endpoints.cjs',
    adapter: 'page',
  },
  {
    name: 'swatch-delete',
    module: 'test-swatch-delete-browser.cjs',
    adapter: 'page-fixture',
    fixture: fixture('json', 'scripts/tests/fixtures/shoulder-region.json'),
  },
];

// Studio acceptance uses committed Vite fixture entries so the original GUI can
// run against source modules and its real workers.  They remain an explicit
// suite instead of being hidden behind one-off smoke commands.
const studioCases = [
  {
    name: 'outliner-delete',
    module: 'studio/test-outliner-delete.cjs',
    adapter: 'studio-fixture',
    fixture: fixture('file', 'scripts/tests/fixtures/v4-original-studio.mjs'),
  },
  {
    name: 'final-preview',
    module: 'smoke/test-v4-final-preview.cjs',
    adapter: 'studio-fixture',
    fixture: fixture('file', 'scripts/tests/fixtures/v4-final-preview.mjs'),
    supportingFiles: [
      'scripts/tests/browser/smoke/review-repair-interactions.cjs',
      'scripts/tests/fixtures/v4-programs.mjs',
    ],
  },
  {
    name: 'original-studio',
    module: 'smoke/test-v4-original-studio.cjs',
    adapter: 'studio-fixture',
    fixture: fixture('file', 'scripts/tests/fixtures/v4-original-studio.mjs'),
  },
  {
    name: 'scene-group-selection',
    module: 'studio/test-scene-group-selection.cjs',
    adapter: 'studio-fixture',
    fixture: fixture('file', 'scripts/tests/fixtures/v4-original-studio.mjs'),
  },
];

function parseArguments(argv) {
  const options = {
    suite: 'legacy',
    target: 'web',
    caseName: null,
    port: DEFAULT_PORT,
    inspectorPort: DEFAULT_INSPECTOR_PORT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    output: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      options.help = true;
      continue;
    }
    if (
      ![
        '--suite',
        '--target',
        '--case',
        '--port',
        '--inspector-port',
        '--timeout',
        '--output',
      ].includes(token)
    )
      throw Error(`未知参数：${token}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw Error(`${token} 需要一个值`);
    if (token === '--suite') options.suite = value;
    else if (token === '--target') options.target = value;
    else if (token === '--case') options.caseName = value;
    else if (token === '--output') options.output = value;
    else {
      const parsed = Number(value);
      if (
        !Number.isInteger(parsed) ||
        parsed < 1 ||
        (token !== '--timeout' && parsed > 65535)
      )
        throw Error(
          token === '--timeout'
            ? '--timeout 必须是正整数毫秒值'
            : `${token} 必须是 1–65535 的整数`,
        );
      if (token === '--port') options.port = parsed;
      else if (token === '--inspector-port') options.inspectorPort = parsed;
      else options.timeoutMs = parsed;
    }
  }
  if (!['legacy', 'studio'].includes(options.suite))
    throw Error(`未知 suite：${options.suite}`);
  if (!['web', 'desktop-frontend'].includes(options.target))
    throw Error(`未知 target：${options.target}`);
  if (options.suite === 'studio' && options.target !== 'web')
    throw Error('studio suite 仅支持 web fixture target。');
  if (options.port === options.inspectorPort)
    throw Error('--port 与 --inspector-port 必须不同。');
  return options;
}

function usage() {
  return [
    'Usage: pnpm test:browser --suite legacy|studio --target web [options]',
    '',
    'Options:',
    '  --suite legacy|studio       defaults to legacy',
    '  --target web|desktop-frontend  defaults to web',
    '  --case <registered-case>       run one registered case',
    `  --port <1-65535>               defaults to ${DEFAULT_PORT}; fails if occupied`,
    `  --inspector-port <1-65535>     defaults to ${DEFAULT_INSPECTOR_PORT}; local only`,
    `  --timeout <ms>                 defaults to ${DEFAULT_TIMEOUT_MS}`,
    '  --output <outputs/v4-qa/run>   optional dedicated artifact directory',
  ].join('\n');
}

function discoverLegacyModules(directory = BROWSER_DIRECTORY) {
  return readdirSync(directory)
    .filter((name) => /^test-.*\.cjs$/.test(name))
    .sort();
}

function verifyLegacyRegistry(directory = BROWSER_DIRECTORY) {
  const discovered = discoverLegacyModules(directory);
  const registered = legacyCases.map((entry) => entry.module).sort();
  const missing = discovered.filter((name) => !registered.includes(name));
  const stale = registered.filter((name) => !discovered.includes(name));
  if (missing.length || stale.length)
    throw Error(
      `legacy browser registry 不完整：未登记 ${missing.join(', ') || '无'}；不存在 ${stale.join(', ') || '无'}`,
    );
  return legacyCases.slice();
}

function verifyStudioRegistry() {
  for (const entry of studioCases) {
    const modulePath = resolve(BROWSER_DIRECTORY, entry.module);
    const fixturePath = entry.fixture && resolve(ROOT, entry.fixture.path);
    if (!existsSync(modulePath) || !fixturePath || !existsSync(fixturePath))
      throw Error(`studio browser registry 不完整：${entry.name}`);
    for (const path of entry.supportingFiles || [])
      if (!existsSync(resolve(ROOT, path)))
        throw Error(
          `studio browser registry 缺少依赖：${entry.name} → ${path}`,
        );
  }
  return studioCases.slice();
}

function selectCases(options, cases) {
  const suiteCases =
    cases ||
    (options.suite === 'legacy'
      ? legacyCases
      : options.suite === 'studio'
        ? studioCases
        : null);
  if (!suiteCases) throw Error(`未知 suite：${options.suite}`);
  const selected = options.caseName
    ? suiteCases.filter((entry) => entry.name === options.caseName)
    : suiteCases;
  if (!selected.length)
    throw Error(`未知或未实施的 ${options.suite} case：${options.caseName}`);
  return selected;
}

function resolveOutputDirectory(requested, runId) {
  const target = requested
    ? resolve(ROOT, requested)
    : resolve(OUTPUT_ROOT, runId);
  const relativePath = relative(OUTPUT_ROOT, target);
  if (
    relativePath === '' ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath === '..' ||
    resolve(OUTPUT_ROOT, relativePath) !== target
  )
    throw Error('--output 必须位于 outputs/v4-qa/ 内的专用运行目录。');
  return target;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function collectFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(directory);
  return files.sort((left, right) => left.localeCompare(right));
}

function digestEntries(root, files) {
  const entries = files.map((path) => ({
    path: relative(root, path).replaceAll('\\', '/'),
    bytes: statSync(path).size,
    sha256: sha256File(path),
  }));
  return {
    entries,
    fileCount: entries.length,
    byteCount: entries.reduce((total, entry) => total + entry.bytes, 0),
    sha256: sha256(
      entries
        .map(
          (entry) => `${entry.path}\u0000${entry.bytes}\u0000${entry.sha256}`,
        )
        .join('\n'),
    ),
  };
}

function directoryDigest(directory) {
  if (!existsSync(directory)) return null;
  const { entries: _, ...summary } = digestEntries(
    directory,
    collectFiles(directory),
  );
  return summary;
}

function matchingEntryDigest(root, patterns) {
  return digestEntries(
    root,
    collectFiles(root).filter((path) => {
      const relativePath = relative(root, path).replaceAll('\\', '/');
      return patterns.some((pattern) => pattern.test(relativePath));
    }),
  ).entries;
}

function buildArtifactManifest() {
  return {
    web: {
      root: 'dist',
      digest: directoryDigest(resolve(ROOT, 'dist')),
      entries: matchingEntryDigest(resolve(ROOT, 'dist'), [
        /^server\/(wrangler\.json|index\.js)$/,
        /^client\/index\.html$/,
        /^client\/.*\/(studio-app|document-worker)-[^/]+\.js$/,
      ]),
    },
    desktopFrontend: {
      root: 'src-tauri/target/frontend',
      digest: directoryDigest(DESKTOP_ROOT),
      entries: matchingEntryDigest(DESKTOP_ROOT, [
        /^index\.html$/,
        /^assets\/(index|document-worker)-[^/]+\.js$/,
      ]),
    },
  };
}

function fixturePath(entry) {
  return entry.fixture ? resolve(ROOT, entry.fixture.path) : null;
}

function caseManifest(entry) {
  const modulePath = resolve(BROWSER_DIRECTORY, entry.module);
  const source = {
    module: relative(ROOT, modulePath).replaceAll('\\', '/'),
    moduleSha256: sha256File(modulePath),
  };
  const path = fixturePath(entry);
  if (path)
    source.fixture = {
      kind: entry.fixture.kind,
      path: relative(ROOT, path).replaceAll('\\', '/'),
      sha256: sha256File(path),
    };
  if (entry.supportingFiles?.length)
    source.supportingFiles = entry.supportingFiles.map((supportingFile) => {
      const supportingPath = resolve(ROOT, supportingFile);
      return {
        path: relative(ROOT, supportingPath).replaceAll('\\', '/'),
        sha256: sha256File(supportingPath),
      };
    });
  return { name: entry.name, adapter: entry.adapter, source };
}

function gitRevision() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function createManifest(options, runId, cases, outputDirectory) {
  return {
    schemaVersion: 1,
    runId,
    status: 'running',
    startedAt: new Date().toISOString(),
    revision: gitRevision(),
    buildArtifacts: buildArtifactManifest(),
    runner: {
      entry: 'scripts/tests/run-browser.cjs',
      harness: 'scripts/tests/browser/harness/browser-runner.cjs',
      web: {
        config: relative(ROOT, WEB_CONFIG).replaceAll('\\', '/'),
        local: true,
        ip: '127.0.0.1',
        persistTo: relative(
          ROOT,
          resolve(outputDirectory, 'wrangler-state'),
        ).replaceAll('\\', '/'),
      },
      desktopFrontend: {
        root: relative(ROOT, DESKTOP_ROOT).replaceAll('\\', '/'),
        ip: '127.0.0.1',
      },
      browser: {
        package: 'playwright',
        isolatedContextPerCase: true,
        isolatedBrowserPerCase: true,
      },
    },
    options: {
      suite: options.suite,
      target: options.target,
      case: options.caseName,
      port: options.port,
      inspectorPort: options.inspectorPort,
      timeoutMs: options.timeoutMs,
    },
    outputDirectory: relative(ROOT, outputDirectory).replaceAll('\\', '/'),
    cases: cases.map(caseManifest),
    results: [],
    errors: [],
  };
}

async function writeManifest(outputDirectory, manifest) {
  await writeFile(
    resolve(outputDirectory, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
}

async function loadFixture(entry) {
  if (!entry.fixture) return undefined;
  const path = fixturePath(entry);
  if (entry.fixture.kind === 'file') return path;
  if (entry.fixture.kind === 'json')
    return normalizeFixtureProject(JSON.parse(await readFile(path, 'utf8')));
  if (entry.fixture.kind === 'module') {
    const fixtureModule = await import(pathToFileURL(path).href);
    const create = fixtureModule[entry.fixture.exportName];
    if (typeof create !== 'function')
      throw Error(`${entry.name} fixture 未导出 ${entry.fixture.exportName}`);
    return normalizeFixtureProject(create());
  }
  if (entry.fixture.kind === 'spl') {
    const { decodeProject } = await import(
      pathToFileURL(resolve(ROOT, 'src/lib/project-format.mjs')).href
    );
    return decodeProject(new Uint8Array(await readFile(path)));
  }
  throw Error(`${entry.name} 的 fixture 类型未知：${entry.fixture.kind}`);
}

function normalizeFixtureProject(project) {
  if (!project || typeof project !== 'object') return project;
  // Older committed fixtures omit the required compatible reference-image URL.
  // The runner supplies the stable public placeholder before calling load_project.
  if (typeof project.image !== 'string') project.image = '/reference.png';
  if (Array.isArray(project.paths)) {
    const groups = Array.isArray(project.groups) ? project.groups : [];
    project.groups = groups;
    const groupIds = new Set(groups.map((group) => group.id));
    for (const path of project.paths) {
      if (typeof path.groupId !== 'string' || groupIds.has(path.groupId))
        continue;
      groups.push({ id: path.groupId, name: `导入分组 ${groupIds.size + 1}` });
      groupIds.add(path.groupId);
    }
  }
  return project;
}

function ensureBuildTarget(target) {
  if (target === 'web') {
    if (!existsSync(WEB_CONFIG))
      throw Error(
        '缺少 dist/server/wrangler.json；请先由整合负责人完成 pnpm build。',
      );
    return;
  }
  if (!existsSync(resolve(DESKTOP_ROOT, 'index.html')))
    throw Error(
      '缺少 src-tauri/target/frontend/index.html；请先由整合负责人完成 pnpm desktop:build。',
    );
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs, child, getStartupError) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (getStartupError?.()) throw getStartupError();
    if (child && child.exitCode !== null)
      throw Error(`测试服务异常退出，退出码 ${child.exitCode}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
      lastError = Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(150);
  }
  throw Error(
    `等待测试服务超时：${url}${lastError ? ` (${lastError.message})` : ''}`,
  );
}

function isWithin(root, path) {
  const relativePath = relative(root, path);
  return (
    relativePath !== '' &&
    !relativePath.startsWith(`..${sep}`) &&
    relativePath !== '..'
  );
}

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

function startStaticServer(root, port) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url || '/', 'http://127.0.0.1').pathname,
      );
      const candidate = resolve(
        root,
        '.' + (pathname === '/' ? '/index.html' : pathname),
      );
      const fallback = resolve(root, 'index.html');
      const file =
        isWithin(root, candidate) && existsSync(candidate)
          ? candidate
          : fallback;
      if (!isWithin(root, file) || !existsSync(file)) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': MIME_TYPES[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(await readFile(file));
    } catch {
      response.writeHead(400).end();
    }
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port }, () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(Error('无法读取隔离静态服务端口'));
        return;
      }
      resolvePromise({
        url: `http://127.0.0.1:${address.port}`,
        async close() {
          await new Promise((resolveClose, rejectClose) =>
            server.close((error) =>
              error ? rejectClose(error) : resolveClose(),
            ),
          );
        },
      });
    });
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((resolvePromise) => {
      const killer = spawn(
        'taskkill',
        ['/pid', String(child.pid), '/t', '/f'],
        {
          stdio: 'ignore',
        },
      );
      killer.once('exit', resolvePromise);
      killer.once('error', resolvePromise);
    });
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), wait(5_000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

function createWebServerArguments(port, inspectorPort, outputDirectory) {
  return [
    'dev',
    '--config',
    WEB_CONFIG,
    '--local',
    '--ip',
    '127.0.0.1',
    '--port',
    String(port),
    '--inspector-ip',
    '127.0.0.1',
    '--inspector-port',
    String(inspectorPort),
    '--persist-to',
    resolve(outputDirectory, 'wrangler-state'),
  ];
}

async function startWebServer(port, inspectorPort, outputDirectory, timeoutMs) {
  const log = createWriteStream(resolve(outputDirectory, 'server.log'), {
    flags: 'a',
  });
  const child = spawn(
    process.execPath,
    [
      require.resolve('wrangler'),
      ...createWebServerArguments(port, inspectorPort, outputDirectory),
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        MINIFLARE_REGISTRY_PATH: resolve(outputDirectory, 'miniflare-registry'),
        WRANGLER_LOG_PATH: resolve(outputDirectory, 'wrangler-logs'),
        WRANGLER_SEND_METRICS: 'false',
        WRANGLER_WRITE_LOGS: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  let startupError;
  child.once('error', (error) => {
    startupError = error;
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  try {
    const url = `http://127.0.0.1:${port}`;
    await waitForHttp(url, timeoutMs, child, () => startupError);
    return {
      url,
      pid: child.pid,
      async close() {
        await stopChild(child);
        log.end();
      },
    };
  } catch (error) {
    await stopChild(child);
    log.end();
    throw error;
  }
}

async function startTargetServer(options, outputDirectory) {
  ensureBuildTarget(options.target);
  if (options.target === 'web')
    return startWebServer(
      options.port,
      options.inspectorPort,
      outputDirectory,
      options.timeoutMs,
    );
  return startStaticServer(DESKTOP_ROOT, options.port);
}

async function startStudioFixtureServer(entry, outputDirectory) {
  const { createServer: createViteServer } = await import('vite');
  const { default: tailwindcss } = await import('@tailwindcss/postcss');
  const fixtureEntry = resolve(ROOT, entry.fixture.path);
  const caseDirectory = resolve(outputDirectory, entry.name);
  const fixtureUrl = '/' + relative(ROOT, fixtureEntry).replaceAll('\\', '/');
  const server = await createViteServer({
    configFile: false,
    root: ROOT,
    cacheDir: resolve(caseDirectory, 'vite-cache'),
    publicDir: resolve(ROOT, 'public'),
    css: { postcss: { plugins: [tailwindcss()] } },
    optimizeDeps: {
      entries: [fixtureEntry],
      include: [
        '@tauri-apps/api/core',
        '@tauri-apps/api/event',
        '@tauri-apps/api/window',
      ],
    },
    resolve: { alias: { '@': resolve(ROOT, 'src') } },
    server: {
      host: '127.0.0.1',
      port: 0,
      hmr: false,
      watch: {
        ignored: [
          '**/src-tauri/target/**',
          '**/dist/**',
          '**/output/**',
          '**/outputs/**',
        ],
      },
    },
    plugins: [
      {
        name: `isolated-${entry.name}`,
        configureServer(devServer) {
          devServer.middlewares.use(async (request, response, next) => {
            if (request.url !== '/') return next();
            const html = await devServer.transformIndexHtml(
              '/',
              `<!doctype html><html><head><meta charset="utf-8"><title>${entry.name}</title><link rel="stylesheet" href="/app/globals.css"><link rel="stylesheet" href="/app/creation.css"></head><body><div id="root"></div><script type="module" src="${fixtureUrl}"></script></body></html>`,
            );
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.end(html);
          });
        },
      },
    ],
  });
  await mkdir(caseDirectory, { recursive: true });
  await server.listen();
  // Prime static imports before opening Chromium. Without this, a fresh Vite
  // optimizer can answer the first module graph with transient 504 responses.
  await server.warmupRequest(fixtureUrl);
  await server.waitForRequestsIdle();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    await server.close();
    throw Error(`无法读取 studio fixture ${entry.name} 的隔离端口`);
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    pid: null,
    kind: 'vite-fixture',
    async close() {
      await server.close();
    },
  };
}

function loadPlaywright() {
  try {
    return require('playwright');
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND')
      throw Error(
        '缺少 Playwright。请由 I00 安装 playwright@1.63.0，并运行 pnpm exec playwright install chromium。',
      );
    throw error;
  }
}

async function runCase(entry, browser, url, outputDirectory, timeoutMs) {
  const test = entry.test || require(resolve(BROWSER_DIRECTORY, entry.module));
  if (typeof test !== 'function') throw Error(`${entry.module} 未导出测试函数`);
  const fixtureValue = await loadFixture(entry);
  if (entry.adapter === 'browser-url-fixture')
    return test(browser, url, fixtureValue);

  const context = await browser.newContext();
  let page;
  const lifecycle = [];
  const browserErrors = [];
  const record = (event) =>
    lifecycle.push({ event, at: new Date().toISOString() });
  browser.once?.('disconnected', () => record('browser-disconnected'));
  context.once?.('close', () => record('context-closed'));
  try {
    if (entry.adapter === 'studio-fixture' && test.setup)
      await test.setup(context);
    page = await context.newPage();
    page.once?.('close', () => record('page-closed'));
    page.once?.('crash', () => record('page-crashed'));
    page.on?.('pageerror', (error) => browserErrors.push(error.message));
    page.on?.('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
    });

    if (entry.adapter !== 'studio-fixture')
      await page.waitForFunction(() => window.traceStudio);
    if (entry.adapter === 'page') return await test(page);
    if (entry.adapter === 'page-output')
      return await test(page, resolve(outputDirectory, entry.name));
    if (entry.adapter === 'page-fixture') return await test(page, fixtureValue);
    if (entry.adapter === 'studio-fixture')
      return await test(page, resolve(outputDirectory, entry.name));
    throw Error(`${entry.name} 的 adapter 未实现：${entry.adapter}`);
  } catch (error) {
    if (page) {
      try {
        const failureDirectory = resolve(outputDirectory, entry.name);
        await mkdir(failureDirectory, { recursive: true });
        await writeFile(
          resolve(failureDirectory, 'failure-lifecycle.json'),
          JSON.stringify(lifecycle, null, 2) + '\n',
        );
        let diagnostics;
        try {
          diagnostics = await page.evaluate(async () => {
            const api = window.traceStudio;
            if (!api?.call) return { traceStudio: false, url: location.href };
            const inspect = async (action) => {
              try {
                return { value: await api.call(action) };
              } catch (cause) {
                return {
                  error: cause instanceof Error ? cause.message : String(cause),
                };
              }
            };
            return {
              traceStudio: true,
              url: location.href,
              state: await inspect('state'),
              creationInspect: await inspect('creation_inspect'),
            };
          });
          diagnostics.browserErrors = browserErrors;
        } catch (diagnosticError) {
          diagnostics = {
            error:
              diagnosticError instanceof Error
                ? diagnosticError.message
                : String(diagnosticError),
          };
        }
        await Promise.all([
          page.screenshot({
            path: resolve(failureDirectory, 'failure.png'),
            fullPage: true,
          }),
          page
            .content()
            .then((html) =>
              writeFile(resolve(failureDirectory, 'failure.html'), html),
            ),
          writeFile(
            resolve(failureDirectory, 'failure-diagnostics.json'),
            JSON.stringify(diagnostics, null, 2) + '\n',
          ),
        ]);
      } catch {
        // Preserve the original browser-test error if diagnostic capture fails.
      }
    }
    throw error;
  } finally {
    await context.close();
  }
}

async function run(options) {
  if (options.help) return { help: usage() };
  if (options.suite === 'legacy') verifyLegacyRegistry();
  else verifyStudioRegistry();
  const cases = selectCases(options);
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const outputDirectory = resolveOutputDirectory(options.output, runId);
  if (existsSync(outputDirectory))
    throw Error(`运行输出目录已存在：${relative(ROOT, outputDirectory)}`);
  await mkdir(outputDirectory, { recursive: true });
  const manifest = createManifest(options, runId, cases, outputDirectory);
  await writeManifest(outputDirectory, manifest);
  let browser;
  let sharedService;
  let caseService;
  try {
    if (options.suite === 'legacy') {
      sharedService = await startTargetServer(options, outputDirectory);
      manifest.service = {
        target: options.target,
        url: sharedService.url,
        pid: sharedService.pid || null,
        inspectorPort: options.target === 'web' ? options.inspectorPort : null,
        persistTo:
          options.target === 'web'
            ? relative(
                ROOT,
                resolve(outputDirectory, 'wrangler-state'),
              ).replaceAll('\\', '/')
            : null,
      };
    }
    manifest.services = [];
    await writeManifest(outputDirectory, manifest);
    let failureCount = 0;
    for (const entry of cases) {
      const startedAt = new Date().toISOString();
      browser = await loadPlaywright().chromium.launch({ headless: true });
      try {
        caseService =
          entry.adapter === 'studio-fixture'
            ? await startStudioFixtureServer(entry, outputDirectory)
            : sharedService;
        manifest.services.push({
          case: entry.name,
          kind: caseService.kind || options.target,
          url: caseService.url,
          pid: caseService.pid || null,
        });
        await writeManifest(outputDirectory, manifest);
        const result = await runCase(
          entry,
          browser,
          caseService.url,
          outputDirectory,
          entry.timeoutMs || options.timeoutMs,
        );
        manifest.results.push({
          name: entry.name,
          status: 'passed',
          startedAt,
          result,
        });
      } catch (error) {
        manifest.results.push({
          name: entry.name,
          status: 'failed',
          startedAt,
          error:
            error instanceof Error
              ? error.stack || error.message
              : String(error),
        });
        failureCount += 1;
      } finally {
        await writeManifest(outputDirectory, manifest);
        await browser.close();
        browser = undefined;
        if (caseService && caseService !== sharedService)
          await caseService.close();
        caseService = undefined;
      }
    }
    if (failureCount > 0)
      throw Error(
        `${failureCount}/${cases.length} 个浏览器案例失败；详见 ${relative(
          ROOT,
          resolve(outputDirectory, 'manifest.json'),
        )}`,
      );
    manifest.status = 'passed';
    return { outputDirectory, manifest };
  } catch (error) {
    manifest.status = 'failed';
    manifest.errors.push(
      error instanceof Error ? error.stack || error.message : String(error),
    );
    throw error;
  } finally {
    manifest.finishedAt = new Date().toISOString();
    await writeManifest(outputDirectory, manifest);
    if (browser) await browser.close();
    if (caseService) await caseService.close();
    if (sharedService) await sharedService.close();
  }
}

module.exports = {
  DEFAULT_PORT,
  DEFAULT_INSPECTOR_PORT,
  DEFAULT_TIMEOUT_MS,
  DESKTOP_ROOT,
  OUTPUT_ROOT,
  WEB_CONFIG,
  caseManifest,
  createWebServerArguments,
  createManifest,
  discoverLegacyModules,
  legacyCases,
  normalizeFixtureProject,
  parseArguments,
  resolveOutputDirectory,
  run,
  runCase,
  selectCases,
  startStaticServer,
  startStudioFixtureServer,
  studioCases,
  usage,
  verifyLegacyRegistry,
  verifyStudioRegistry,
};
