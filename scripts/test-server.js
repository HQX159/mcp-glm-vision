// MCP 冒烟测试：启动 server，走 initialize -> tools/list，无 key 时再验证报错路径
// 用法: node scripts/test-server.js
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, ["dist/index.js"], {
  cwd: root,
  stdio: ["pipe", "pipe", "pipe"],
});

let pending = "";
let failed = false;

function line(msg) {
  console.log(JSON.stringify(msg, null, 2));
}

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  pending += chunk;
  let idx;
  while ((idx = pending.indexOf("\n")) >= 0) {
    const raw = pending.slice(0, idx).trim();
    pending = pending.slice(idx + 1);
    if (!raw) continue;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      continue;
    }
    if (msg.id === 1) {
      line(msg);
      console.log("[OK] initialize 成功");
    } else if (msg.id === 2) {
      const tools = msg.result?.tools ?? [];
      console.log(`\n[OK] 注册工具 ${tools.length} 个: ${tools.map((t) => t.name).join(", ")}`);
      if (!process.env.ZHIPU_API_KEY) {
        child.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
              name: "analyze_image",
              arguments: { source: path.join(root, "test-assets", "test.png") },
            },
          }) + "\n"
        );
      } else {
        child.stdin.end();
        setTimeout(() => process.exit(failed ? 1 : 0), 100);
      }
    } else if (msg.id === 3) {
      const text = msg.result?.content?.[0]?.text ?? "";
      const isError = msg.result?.isError === true;
      console.log("\n[tools/call] 返回:", text);
      if (isError && text.includes("ZHIPU_API_KEY")) {
        console.log("[OK] 未配置 key 时报错路径正常");
      } else {
        console.log("[FAIL] 预期返回 ZHIPU_API_KEY 相关错误");
        failed = true;
      }
      child.stdin.end();
      setTimeout(() => process.exit(failed ? 1 : 0), 100);
    }
  }
});

child.stderr.setEncoding("utf8");
child.stderr.on("data", (d) => process.stderr.write("[server] " + d));

child.on("exit", (code) => {
  if (code && code !== 0) {
    console.error(`[FAIL] server 退出码 ${code}`);
    process.exit(1);
  }
});

child.stdin.write(
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "0.0.1" },
    },
  }) + "\n"
);
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n");

setTimeout(() => {
  console.error("[FAIL] 超时");
  child.kill();
  process.exit(1);
}, 15000);