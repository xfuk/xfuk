#!/usr/bin/env node
/*
 * build-single.js - index.html と assets/ を1枚の HTML にまとめる。
 *
 *   node tools/build-single.js              → dist/vipass-standalone.html
 *       配布用。単体で開ける完全な HTML。USB メモリや LMS への設置向け。
 *
 *   node tools/build-single.js --artifact [出力先]
 *       Artifact など、<html>/<head>/<body> を外側で用意する場所に貼る断片。
 *
 * 追加の依存はなし。Node だけで動く。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const artifactMode = process.argv.includes('--artifact');
const outArg = process.argv.find((a, i) => i > 1 && !a.startsWith('--'));

let html = read('index.html');

// CSS を <style> に取り込む
const css = read('assets/css/style.css');
html = html.replace(
  /<link rel="stylesheet" href="assets\/css\/style\.css">/,
  '<style>\n' + css + '\n</style>'
);

// JS を <script> に取り込む（読み込み順はそのまま）
html = html.replace(/<script src="(assets\/js\/[^"]+)"><\/script>/g, (_, src) =>
  '<script>\n' + read(src) + '\n</script>'
);

if (html.includes('assets/')) {
  console.error('取り込まれていない assets/ への参照が残っています。');
  process.exit(1);
}

let out;
if (artifactMode) {
  // <title>、フォント、<style> と本文・スクリプトだけを残す
  const head = html.slice(html.indexOf('<title>'), html.indexOf('</head>'));
  const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'));
  out = head.trim() + '\n' + body.trim() + '\n';
} else {
  out = html;
}

const dest = outArg || (artifactMode
  ? 'dist/vipass-artifact.html'
  : 'dist/vipass-standalone.html');
const destPath = path.isAbsolute(dest) ? dest : path.join(root, dest);
fs.mkdirSync(path.dirname(destPath), { recursive: true });
fs.writeFileSync(destPath, out, 'utf8');
console.log(destPath + '  (' + Math.round(out.length / 1024) + ' KB)');
