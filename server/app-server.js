import fs from 'node:fs';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
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

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const TELNET_IAC = 255;
const TELNET_WILL = 251;
const TELNET_WONT = 252;
const TELNET_DO = 253;
const TELNET_DONT = 254;
const TELNET_SB = 250;
const TELNET_SE = 240;

const DEFAULT_MUD_WS_TARGETS = {
  acktng: { host: '10.1.0.241', port: 8890, name: 'ACK!TNG' },
  ack431: { host: '10.1.0.242', port: 4000, name: 'ACK! 4.3.1' },
  ack42: { host: '10.1.0.243', port: 4000, name: 'ACK! 4.2' },
  ack41: { host: '10.1.0.244', port: 4000, name: 'ACK! 4.1' },
  assault: { host: '10.1.0.245', port: 4000, name: 'Assault 3.0' },
  ackfuss: { host: '10.1.0.250', port: 4000, name: 'ACK!FUSS' },
};

function envTarget(key, fallback) {
  const envKey = key.toUpperCase().replaceAll('-', '_');
  return {
    ...fallback,
    host: process.env[`MUD_WS_${envKey}_HOST`] ?? fallback.host,
    port: Number(process.env[`MUD_WS_${envKey}_PORT`] ?? fallback.port),
  };
}

function envMudTargets() {
  return Object.fromEntries(
    Object.entries(DEFAULT_MUD_WS_TARGETS).map(([key, target]) => [key, envTarget(key, target)]),
  );
}

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
    wsTargets: envMudTargets(),
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

function resolveWsTarget(pathname, targets) {
  const match = pathname.match(/^\/ws(?:\/([^/?#]+))?\/?$/);
  if (!match) return null;
  const key = match[1] ?? 'acktng';
  return targets[key] ? { key, ...targets[key] } : null;
}

function websocketAccept(key) {
  return crypto.createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
}

function sendWsFrame(socket, opcode, payload = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header;

  if (body.length < 126) {
    header = Buffer.from([0x80 | opcode, body.length]);
  } else if (body.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }

  socket.write(Buffer.concat([header, body]));
}

function closeWebsocket(socket, code = 1000, reason = '') {
  const reasonBytes = Buffer.from(reason);
  const payload = Buffer.alloc(2 + reasonBytes.length);
  payload.writeUInt16BE(code, 0);
  reasonBytes.copy(payload, 2);
  sendWsFrame(socket, 0x8, payload);
  socket.end();
}

function stripTelnetNegotiation(chunk, mudSocket) {
  const output = [];

  for (let index = 0; index < chunk.length; index += 1) {
    const byte = chunk[index];
    if (byte !== TELNET_IAC) {
      output.push(byte);
      continue;
    }

    const command = chunk[index + 1];
    if (command === undefined) break;

    if (command === TELNET_IAC) {
      output.push(TELNET_IAC);
      index += 1;
      continue;
    }

    if ([TELNET_WILL, TELNET_WONT, TELNET_DO, TELNET_DONT].includes(command)) {
      const option = chunk[index + 2];
      if (option === undefined) break;
      if (command === TELNET_DO) {
        mudSocket.write(Buffer.from([TELNET_IAC, TELNET_WONT, option]));
      } else if (command === TELNET_WILL) {
        mudSocket.write(Buffer.from([TELNET_IAC, TELNET_DONT, option]));
      }
      index += 2;
      continue;
    }

    if (command === TELNET_SB) {
      index += 2;
      while (index < chunk.length - 1 && !(chunk[index] === TELNET_IAC && chunk[index + 1] === TELNET_SE)) {
        index += 1;
      }
      if (index < chunk.length - 1) index += 1;
      continue;
    }

    index += 1;
  }

  return Buffer.from(output);
}

function createClientFrameHandler(wsSocket, mudSocket) {
  let buffered = Buffer.alloc(0);

  return (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);

    while (buffered.length >= 2) {
      const first = buffered[0];
      const opcode = first & 0x0f;
      const second = buffered[1];
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (buffered.length < offset + 2) return;
        length = buffered.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (buffered.length < offset + 8) return;
        const bigLength = buffered.readBigUInt64BE(offset);
        if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
          closeWebsocket(wsSocket, 1009, 'frame too large');
          return;
        }
        length = Number(bigLength);
        offset += 8;
      }

      if (!masked) {
        closeWebsocket(wsSocket, 1002, 'client frames must be masked');
        return;
      }

      if (buffered.length < offset + 4 + length) return;

      const mask = buffered.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.from(buffered.subarray(offset, offset + length));
      buffered = buffered.subarray(offset + length);

      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }

      if (opcode === 0x8) {
        mudSocket.end();
        closeWebsocket(wsSocket);
        return;
      }

      if (opcode === 0x9) {
        sendWsFrame(wsSocket, 0xA, payload);
        continue;
      }

      if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
        mudSocket.write(payload);
      }
    }
  };
}

function handleMudWebsocket(req, wsSocket, head, targets) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const target = resolveWsTarget(decodeURIComponent(url.pathname), targets);
  const key = req.headers['sec-websocket-key'];

  if (!target) {
    wsSocket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    wsSocket.destroy();
    return;
  }

  if (typeof key !== 'string' || req.headers.upgrade?.toLowerCase() !== 'websocket') {
    wsSocket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    wsSocket.destroy();
    return;
  }

  const mudSocket = net.createConnection({ host: target.host, port: target.port });
  let accepted = false;

  mudSocket.once('connect', () => {
    accepted = true;
    wsSocket.setNoDelay(true);
    wsSocket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${websocketAccept(key)}`,
      '',
      '',
    ].join('\r\n'));

    const handleClientFrame = createClientFrameHandler(wsSocket, mudSocket);
    wsSocket.on('data', handleClientFrame);
    if (head.length > 0) handleClientFrame(head);
  });

  mudSocket.on('data', (chunk) => {
    const display = stripTelnetNegotiation(chunk, mudSocket);
    if (display.length > 0) {
      sendWsFrame(wsSocket, 0x1, Buffer.from(display.toString('latin1'), 'utf8'));
    }
  });

  mudSocket.on('error', () => {
    if (!accepted) {
      wsSocket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      wsSocket.destroy();
      return;
    }
    closeWebsocket(wsSocket, 1011, 'mud target unavailable');
  });

  mudSocket.on('end', () => {
    if (!wsSocket.destroyed) closeWebsocket(wsSocket);
  });

  wsSocket.on('error', () => {
    mudSocket.destroy();
  });

  wsSocket.on('close', () => {
    mudSocket.destroy();
  });
}

export function createAppServer(options = {}) {
  const config = {
    ...envConfig(),
    ...options,
  };
  const fetchFn = options.fetchFn ?? fetch;

  const server = http.createServer(async (req, res) => {
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

  server.on('upgrade', (req, socket, head) => {
    handleMudWebsocket(req, socket, head, config.wsTargets);
  });

  return server;
}

if (process.argv[1] === __filename) {
  const config = envConfig();
  const server = createAppServer(config);
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`ack-web listening on :${config.port}\n`);
  });
}
