// 直接调用智谱 API 的演示脚本（不走 MCP 协议）：
//   node scripts/demo.js <图片路径或URL> [提问]
// 需要先 npm run build，并设置环境变量 ZHIPU_API_KEY
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chat, resolveSource } from "../dist/glm.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const source = process.argv[2];
if (!source) {
  console.error("用法: node scripts/demo.js <图片路径或URL> [提问]");
  process.exit(1);
}
const prompt = process.argv[3] || "请详细描述这张图片的内容";
console.error(`[demo] 模型: 见 GLM_MODEL 环境变量（默认 glm-4.6v-flash）; 输入: ${source}`);
const media = [resolveSource(source, "image_url")];
const text = await chat(prompt, media);
console.log(text);