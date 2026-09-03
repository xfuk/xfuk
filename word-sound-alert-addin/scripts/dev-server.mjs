// 開発用の静的ファイルサーバー
//   node scripts/dev-server.mjs --port 3000        (https、Office アドイン用)
//   node scripts/dev-server.mjs --http --port 8080 (http、ブラウザデモ用)
// https では office-addin-dev-certs の開発用証明書を使う(初回は自動で生成・インストールを促す)。
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const useHttp = args.includes('--http');
const portIdx = args.indexOf('--port');
const port = portIdx >= 0 ? Number(args[portIdx + 1]) : useHttp ? 8080 : 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/demo/index.html';
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('not found: ' + p);
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(file).pipe(res);
  });
}

async function main() {
  if (useHttp) {
    http.createServer(handler).listen(port, () => console.log(`http://localhost:${port}/  (root: ${root})`));
    return;
  }
  const { getHttpsServerOptions } = await import('office-addin-dev-certs');
  const options = await getHttpsServerOptions();
  https.createServer(options, handler).listen(port, () => console.log(`https://localhost:${port}/  (root: ${root})`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
