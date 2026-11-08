// MCP 全链路测试：启动 server -> tools/call analyze_image
// 用法: node --env-file=.env scripts/test-call.js [图片路径或URL]
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = process.argv[2] || path.join(root, "test-assets", "test.png");
const child = spawn(process.execPath, ["dist/index.js"], {
  cwd: root,
  env: { ...process.env },
  stdio: ["pipe", "pipe", "pipe"],
});

let pending = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  pending += chunk;
  let idx;
  while ((idx = pending.indexOf("\n")) >= 0) {
    const raw = pending.slice(0, idx).trim();
    pending = pending.slice(idx + 1);
    if (!raw) continue;
    let msg;
    try { msg = JSON.parse(raw); } catch { continue; }
    if (msg.id === 2) {
      console.log("[tools/call] analyze_image 结果:");
      console.log(msg.result?.content?.[0]?.text ?? JSON.stringify(msg));
      child.stdin.end();
      setTimeout(() => process.exit(0), 100);
    }
  }
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (d) => process.stderr.write("[server] " + d));
child.on("exit", (code) => { if (code && code !== 0) process.exit(1); });

child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "call-test", version: "0.0.1" } } }) + "\n");
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "analyze_image", arguments: { source } } }) + "\n");

setTimeout(() => { console.error("[FAIL] timeout"); child.kill(); process.exit(1); }, 60000);