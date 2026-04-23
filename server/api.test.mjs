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
  if (url.endsWith('/who')) {
    return Promise.resolve(new Response('<h2>Players Online</h2><ul><li>Gandalf</li></ul>'));
  }
  if (url.endsWith('/gsgp')) {
    return Promise.resolve(new Response('{"name":"ACK!MUD TNG","active_players":1,"leaderboards":[]}'));
  }
  throw new Error(`unexpected url ${url}`);
}

function requestText(baseUrl, pathname, host) {
  const url = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const headers = host ? { Host: host } : {};
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'GET',
      headers,
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

test('api endpoints match merged-site behavior', async () => {
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
  fs.mkdirSync(path.join(publicDir, 'wol'));
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<html><body>spa</body></html>');
  fs.writeFileSync(path.join(helpDir, 'fire'), 'Fire burns things.');
  fs.writeFileSync(path.join(loreDir, 'dragon'), 'keywords dragon\n---\nDragons breathe fire.\n---\nflags city\n---\nCity lore.');
  fs.writeFileSync(path.join(publicDir, 'wol', 'home.content.html'), '<h1>World of Lore</h1>');
  fs.writeFileSync(path.join(publicDir, 'wol', 'stories.content.html'), '<h1>Stories</h1><section class="story-card"></section>');
  fs.writeFileSync(path.join(publicDir, 'wol', 'site.css'), 'body{}');
  fs.writeFileSync(path.join(publicDir, 'wol', 'stories.js'), 'console.log("stories");');

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
  assert.deepEqual(await indexResponse.json(), ['fire']);

  const topicResponse = await fetch(`${baseUrl}/api/reference/help/fire`);
  assert.equal(await topicResponse.text(), 'Fire burns things.');

  const loreResponse = await fetch(`${baseUrl}/api/reference/lore/dragon`);
  assert.equal(await loreResponse.text(), 'Dragons breathe fire.');

  const traversalResponse = await fetch(`${baseUrl}/api/reference/help/..%2F..%2Fetc%2Fpasswd`);
  assert.equal(traversalResponse.status, 404);

  const spaResponse = await fetch(`${baseUrl}/acktng`);
  assert.equal(spaResponse.status, 200);
  assert.match(await spaResponse.text(), /spa/);

  const wolHome = await requestText(baseUrl, '/');
  assert.equal(wolHome.status, 200);
  assert.match(wolHome.body, /ACKmud\.com/);

  const wolStories = await requestText(baseUrl, '/stories');
  assert.equal(wolStories.status, 200);
  assert.match(wolStories.body, /story-card/);

  const archiveHome = await fetch(`${baseUrl}/archive`);
  assert.equal(archiveHome.status, 200);
  assert.match(await archiveHome.text(), /spa/);

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
