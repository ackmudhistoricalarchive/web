import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import { once } from 'node:events';
import { createAppServer } from './app-server.js';

function encodeClientFrame(text) {
  const payload = Buffer.from(text);
  const mask = Buffer.from([1, 2, 3, 4]);
  const header = Buffer.from([0x81, 0x80 | payload.length]);
  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index += 1) {
    masked[index] ^= mask[index % 4];
  }
  return Buffer.concat([header, mask, masked]);
}

function tryDecodeServerText(buffer) {
  if (buffer.length < 2) return null;
  assert.equal(buffer[0] & 0x0f, 0x1);
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  }
  if (buffer.length < offset + length) return null;
  return buffer.subarray(offset, offset + length).toString('utf8');
}

async function readUntil(socket, initial, predicate) {
  let buffer = initial;
  while (!predicate(buffer)) {
    const timer = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('timed out waiting for websocket data')), 3000);
    });
    const [chunk] = await Promise.race([once(socket, 'data'), timer]);
    buffer = Buffer.concat([buffer, chunk]);
  }
  return buffer;
}

test('websocket bridge proxies text frames to a mud tcp target', async () => {
  const mudSockets = new Set();
  const mudServer = net.createServer((socket) => {
    mudSockets.add(socket);
    socket.on('close', () => {
      mudSockets.delete(socket);
    });
    socket.write(Buffer.from([255, 251, 1]));
    socket.write('Welcome to test mud\n');
    socket.on('data', (chunk) => {
      if (chunk[0] === 255) return;
      socket.write(`echo:${chunk.toString('utf8')}`);
    });
  });
  mudServer.listen(0, '127.0.0.1');
  await once(mudServer, 'listening');
  const mudAddress = mudServer.address();

  const appServer = createAppServer({
    wsTargets: {
      testmud: { host: '127.0.0.1', port: mudAddress.port, name: 'Test MUD' },
    },
  });
  appServer.listen(0, '127.0.0.1');
  await once(appServer, 'listening');
  const appAddress = appServer.address();

  const client = net.createConnection({ host: '127.0.0.1', port: appAddress.port });
  await once(client, 'connect');

  const key = crypto.randomBytes(16).toString('base64');
  client.write([
    'GET /ws/testmud HTTP/1.1',
    `Host: 127.0.0.1:${appAddress.port}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13',
    '',
    '',
  ].join('\r\n'));

  const received = await readUntil(client, Buffer.alloc(0), (buffer) => buffer.includes(Buffer.from('\r\n\r\n')));

  assert.match(received.toString('utf8'), /101 Switching Protocols/);
  const frameStart = received.indexOf('\r\n\r\n') + 4;
  let frame = await readUntil(client, received.subarray(frameStart), (buffer) => Boolean(tryDecodeServerText(buffer)));
  let welcome = tryDecodeServerText(frame);
  assert.match(welcome, /Welcome to test mud/);

  client.write(encodeClientFrame('look\n'));
  const echoFrame = await readUntil(client, Buffer.alloc(0), (buffer) => tryDecodeServerText(buffer)?.includes('echo:look'));
  assert.match(tryDecodeServerText(echoFrame) ?? '', /echo:look/);

  client.destroy();
  for (const socket of mudSockets) {
    socket.destroy();
  }
  appServer.closeAllConnections();
  await new Promise((resolve) => appServer.close(resolve));
  await new Promise((resolve) => mudServer.close(resolve));
});
