import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createAppServer } from './app-server.js';

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ack-web-api-'));
}

function fakeFetch(url) {
  const requestUrl = String(url);
  if (requestUrl.endsWith('/who')) {
    return Promise.resolve(new Response('<h2>Players Online</h2><ul><li>Gandalf</li></ul>'));
  }
  if (requestUrl.endsWith('/gsgp')) {
    return Promise.resolve(new Response('{"name":"ACK!MUD TNG","active_players":1,"leaderboards":[]}'));
  }
  if (requestUrl.endsWith('/helps')) {
    return Promise.resolve(Response.json([{ id: 7, keyword: 'fire burn', title: 'Fire', level: 0, text: 'Fire burns things.' }]));
  }
  if (requestUrl.endsWith('/helps/7')) {
    return Promise.resolve(Response.json({ id: 7, keyword: 'fire burn', title: 'Fire', level: 0, text: 'Fire burns things.' }));
  }
  if (requestUrl.endsWith('/lores/9')) {
    return Promise.resolve(Response.json({
      id: 9,
      name: 'Dragon',
      keyword: 'dragon',
      description: 'Scaled histories.',
      entries: [{ id: 1, seq: 1, keyword: '0', text: 'Dragons breathe fire.' }],
    }));
  }
  throw new Error(`unexpected url ${requestUrl}`);
}

function requestText(baseUrl, pathname, host) {
  const url = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'GET',
      headers: {
        Host: host,
      },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('api endpoints match legacy behavior', async () => {
  const root = makeTempRoot();
  const helpDir = path.join(root, 'help');
  const shelpDir = path.join(root, 'shelp');
  const loreDir = path.join(root, 'lore');
  const staticDir = path.join(root, 'dist');
  fs.mkdirSync(helpDir);
  fs.mkdirSync(shelpDir);
  fs.mkdirSync(loreDir);
  fs.mkdirSync(staticDir);
  const publicDir = path.join(root, 'public');
  fs.mkdirSync(publicDir);
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<html><body>spa</body></html>');
  fs.writeFileSync(path.join(helpDir, 'fire'), 'Fire burns things.');
  fs.writeFileSync(path.join(loreDir, 'dragon'), 'keywords dragon\n---\nDragons breathe fire.\n---\nflags city\n---\nCity lore.');

  const server = createAppServer({ helpDir, shelpDir, loreDir, staticDir, publicDir, fetchFn: fakeFetch });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const whoResponse = await fetch(`${baseUrl}/api/who`);
  assert.equal(whoResponse.status, 200);
  assert.match(await whoResponse.text(), /Gandalf/);

  const gsgpResponse = await fetch(`${baseUrl}/api/gsgp`);
  assert.equal(gsgpResponse.status, 200);
  assert.match(await gsgpResponse.text(), /active_players/);

  const indexResponse = await fetch(`${baseUrl}/api/reference/help`);
  assert.deepEqual(await indexResponse.json(), [{ id: '7', label: 'Fire', description: '' }]);

  const topicResponse = await fetch(`${baseUrl}/api/reference/help/7`);
  assert.deepEqual(await topicResponse.json(), { id: '7', label: 'Fire', content: 'Fire burns things.' });

  const loreResponse = await fetch(`${baseUrl}/api/reference/lore/9`);
  assert.deepEqual(await loreResponse.json(), {
    id: '9',
    label: 'Dragon',
    content: 'Scaled histories.\n\nDragons breathe fire.',
  });

  const traversalResponse = await fetch(`${baseUrl}/api/reference/help/..%2F..%2Fetc%2Fpasswd`);
  assert.equal(traversalResponse.status, 404);

  const spaResponse = await fetch(`${baseUrl}/acktng`);
  assert.equal(spaResponse.status, 200);
  assert.match(await spaResponse.text(), /spa/);

  const archiveHome = await requestText(baseUrl, '/', 'ackmud.com');
  assert.equal(archiveHome.status, 200);
  assert.match(archiveHome.body, /spa/);

  const oldWolStories = await requestText(baseUrl, '/stories', 'ackmud.com');
  assert.equal(oldWolStories.status, 200);
  assert.match(oldWolStories.body, /spa/);
  assert.doesNotMatch(oldWolStories.body, /story-card/);

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve(undefined);
      }
    });
  });
  fs.rmSync(root, { recursive: true, force: true });
});
