import fs from 'node:fs';
import path from 'node:path';

export function safeTopicPath(baseDir, topic) {
  const cleaned = topic.trim().replace(/^\/+|\/+$/g, '');
  if (!cleaned) {
    return null;
  }

  const resolvedBase = path.resolve(baseDir);
  const candidate = path.resolve(resolvedBase, cleaned);

  if (!candidate.startsWith(`${resolvedBase}${path.sep}`)) {
    return null;
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    return null;
  }

  return candidate;
}

export function extractFirstLoreEntry(content) {
  const blocks = content.split(/\r?\n---\r?\n/);
  for (let index = 0; index < blocks.length; index += 1) {
    if (blocks[index].trimStart().startsWith('keywords ') && index + 1 < blocks.length) {
      return blocks[index + 1].trim();
    }
  }
  return content.trim();
}

export function resolveRefDir(type, helpDir, shelpDir, loreDir) {
  if (type === 'shelp') {
    return shelpDir;
  }
  if (type === 'lore') {
    return loreDir;
  }
  return helpDir;
}

export function listTopics(dir, query = '') {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const normalizedQuery = query.trim().toLowerCase();
  return fs.readdirSync(dir)
    .filter((name) => {
      if (!normalizedQuery) {
        return true;
      }
      return name.toLowerCase().includes(normalizedQuery);
    })
    .sort((left, right) => left.localeCompare(right));
}
