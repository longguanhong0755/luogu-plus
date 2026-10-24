#!/usr/bin/env node
/* 探针测试站的 Node 版静态服务器：CI 不依赖 Python，本地也可用。
   用法: node scripts/serve-fixture.cjs <port> <root> */
const http = require("http");
const fs = require("fs");
const path = require("path");

const port = Number(process.argv[2] || 8911);
const root = path.resolve(process.argv[3] || ".");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

http
  .createServer((req, res) => {
    let rel = decodeURIComponent(String(req.url || "/").split("?")[0]);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.resolve(root, "." + rel);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, {
        "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(data);
    });
  })
  .listen(port, "127.0.0.1", () => {
    console.log("fixture server http://127.0.0.1:" + port + " root=" + root);
  });
