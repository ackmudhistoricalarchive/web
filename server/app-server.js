import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFirstLoreEntry, listTopics, resolveRefDir, safeTopicPath } from './reference.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

function envConfig() {
  const acktngDir = process.env.ACKTNG_DIR ?? path.join(os.homedir(), 'acktng');
  return {
    port: Number(process.env.PORT ?? '5000'),
    staticDir: process.env.STATIC_DIR ?? path.join(repoRoot, 'dist'),
    gameUrl: process.env.ACKTNG_GAME_URL ?? 'http://10.1.0.241:8080',
    helpDir: process.env.HELP_DIR ?? path.join(acktngDir, 'help'),
    shelpDir: process.env.SHELP_DIR ?? path.join(acktngDir, 'shelp'),
    loreDir: process.env.LORE_DIR ?? path.join(acktngDir, 'lore'),
    publicDir: process.env.PUBLIC_DIR ?? path.join(repoRoot, 'public'),
  };
}

function send(res, status, body, contentType) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function fallbackWho() {
  return '<h2>Players Online</h2>\n<ul></ul>';
}

function fallbackGsgp() {
  return '{"name":"ACK!MUD TNG","active_players":0,"leaderboards":[]}';
}

async function fetchUpstream(url, fallbackBody, contentType, fetchFn) {
  try {
    const response = await fetchFn(url, { signal: AbortSignal.timeout(3000) });
    const body = await response.text();
    return { status: 200, body, contentType };
  } catch {
    return { status: 200, body: fallbackBody, contentType };
  }
}

function serveStatic(res, staticDir, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const candidate = path.resolve(staticDir, `.${requested}`);
  const resolvedStatic = path.resolve(staticDir);

  if (candidate.startsWith(`${resolvedStatic}${path.sep}`) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    const contentType = MIME_TYPES[path.extname(candidate)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(candidate).pipe(res);
    return true;
  }

  const indexPath = path.join(staticDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(indexPath).pipe(res);
    return true;
  }

  return false;
}

function readPublicFile(publicDir, relPath) {
  return fs.readFileSync(path.join(publicDir, relPath), 'utf8');
}

function renderWolPage(config, pageTitle, body, activePath) {
  const navClass = (href) => href === activePath ? 'active' : '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${pageTitle}</title>
    <link rel="stylesheet" href="/wol/site.css" />
  </head>
  <body>
    <div class="site-shell">
      <header class="site-brand">
        <h2>World of Lore</h2>
        <p>ACKmud.com: World of Lore, the archive, and the live game sections in one place.</p>
      </header>
      <nav class="site-nav">
        <a class="${navClass('/')}" href="/">Home</a>
        <a class="${navClass('/stories')}" href="/stories">Stories</a>
        <a class="${navClass('/archive')}" href="/archive">Archive</a>
        <a class="${navClass('/acktng')}" href="/acktng">ACK!TNG</a>
        <a class="${navClass('/acktng/who')}" href="/acktng/who">Who</a>
        <a class="${navClass('/acktng/mud')}" href="/acktng/mud">MUD Client</a>
        <a class="${navClass('/acktng/map')}" href="/acktng/map">Map</a>
        <a class="${navClass('/acktng/reference/help')}" href="/acktng/reference/help">Reference</a>
        <a href="https://discord.gg/T24UQV8h" target="_blank" rel="noopener noreferrer">Discord</a>
        <a href="https://github.com/ackmudhistoricalarchive" target="_blank" rel="noopener noreferrer">GitHub</a>
      </nav>
      <main>
${body}
      </main>
    </div>
    <script src="/wol/stories.js"></script>
  </body>
</html>`;
}

export function createAppServer(options = {}) {
  const config = {
    ...envConfig(),
    ...options,
  };
  const fetchFn = options.fetchFn ?? fetch;

  return http.createServer(async (req, res) => {
    if (!req.url) {
      send(res, 400, 'Bad request', 'text/plain; charset=utf-8');
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/health') {
      send(res, 200, 'ok\n', 'text/plain; charset=utf-8');
      return;
    }

    if (pathname === '/') {
      const body = readPublicFile(config.publicDir, 'wol/home.content.html');
      send(res, 200, renderWolPage(config, 'ACKmud.com - World of Lore', body, '/'), 'text/html; charset=utf-8');
      return;
    }

    if (pathname === '/stories') {
      const body = readPublicFile(config.publicDir, 'wol/stories.content.html');
      send(res, 200, renderWolPage(config, 'Tales from the Age of Monuments - ACKmud.com', body, '/stories'), 'text/html; charset=utf-8');
      return;
    }

    if (pathname === '/api/who') {
      const upstream = await fetchUpstream(`${config.gameUrl}/who`, fallbackWho(), 'text/html; charset=utf-8', fetchFn);
      send(res, upstream.status, upstream.body, upstream.contentType);
      return;
    }

    if (pathname === '/api/gsgp') {
      const upstream = await fetchUpstream(`${config.gameUrl}/gsgp`, fallbackGsgp(), 'application/json', fetchFn);
      send(res, upstream.status, upstream.body, upstream.contentType);
      return;
    }

    const referenceIndexMatch = pathname.match(/^\/api\/reference\/([^/]+)$/);
    if (referenceIndexMatch) {
      const dir = resolveRefDir(referenceIndexMatch[1], config.helpDir, config.shelpDir, config.loreDir);
      const items = listTopics(dir, url.searchParams.get('q') ?? '');
      send(res, 200, JSON.stringify(items), 'application/json');
      return;
    }

    const referenceTopicMatch = pathname.match(/^\/api\/reference\/([^/]+)\/(.+)$/);
    if (referenceTopicMatch) {
      const [, type, topic] = referenceTopicMatch;
      const dir = resolveRefDir(type, config.helpDir, config.shelpDir, config.loreDir);
      const filePath = safeTopicPath(dir, topic);
      if (!filePath) {
        send(res, 404, 'Not found', 'text/plain; charset=utf-8');
        return;
      }

      let content = fs.readFileSync(filePath, 'utf8');
      if (type === 'lore') {
        content = extractFirstLoreEntry(content);
      }
      send(res, 200, content, 'text/plain; charset=utf-8');
      return;
    }

    if (serveStatic(res, config.publicDir, pathname)) {
      return;
    }

    if (serveStatic(res, config.staticDir, pathname)) {
      return;
    }

    send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  });
}

if (process.argv[1] === __filename) {
  const config = envConfig();
  const server = createAppServer(config);
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`ack-web listening on :${config.port}\n`);
  });
}
