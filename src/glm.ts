import fs from "node:fs";
import path from "node:path";

export const API_KEY = process.env.ZHIPU_API_KEY || "";
export const MODEL = process.env.GLM_MODEL || "glm-4.6v-flash";
export const API_URL =
  process.env.GLM_API_URL || "https://open.bigmodel.cn/api/paas/v4/chat/completions";
export const TIMEOUT_MS = Number(process.env.GLM_TIMEOUT_MS || 120_000);

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export type MediaKind = "image_url" | "video_url" | "file_url";

export interface MediaItem {
  kind: MediaKind;
  url: string;
}

/** 本地文件转成 base64 data URL（智谱接口要求本地图片走 data URL） */
export function fileToDataUrl(filePath: string): string {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${abs}`);
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) throw new Error(`这是目录，不是文件: ${abs}`);
  const ext = path.extname(abs).toLowerCase();
  const mime = MIME_BY_EXT[ext] || "application/octet-stream";
  const base64 = fs.readFileSync(abs).toString("base64");
  return `data:${mime};base64,${base64}`;
}

/** 把「本地路径 / http(s) URL / data URL」统一解析成可传给智谱的媒体项 */
export function resolveSource(source: string, kind: MediaKind): MediaItem {
  if (/^https?:\/\//i.test(source)) return { kind, url: source };
  if (/^data:/i.test(source)) {
    const mime = source.slice(5, source.indexOf(";")) || "";
    return { kind: detectKindByMime(mime), url: source };
  }
  if (source.startsWith("file://")) source = source.slice("file://".length);
  const ext = path.extname(source).toLowerCase();
  const mime = MIME_BY_EXT[ext] || "";
  const effectiveKind: MediaKind = mime.startsWith("image/")
    ? "image_url"
    : mime.startsWith("video/")
      ? "video_url"
      : kind;
  const dataUrl = fileToDataUrl(source);
  if (dataUrl.length > 12_000_000) {
    throw new Error(
      `本地文件过大（编码后约 ${(dataUrl.length / 1024 / 1024).toFixed(1)}MB），请先压缩；视频/大文件建议使用公网 URL`
    );
  }
  return { kind: effectiveKind, url: dataUrl };
}

function detectKindByMime(mime: string): MediaKind {
  if (mime.startsWith("image/")) return "image_url";
  if (mime.startsWith("video/")) return "video_url";
  return "file_url";
}

export interface ChatOptions {
  thinking?: boolean;
}

export function buildMessages(prompt: string, media: MediaItem[]) {
  const content: unknown[] = [];
  if (prompt) content.push({ type: "text", text: prompt });
  for (const item of media) {
    const wrapper =
      item.kind === "video_url"
        ? { video_url: { url: item.url } }
        : item.kind === "file_url"
          ? { file_url: { url: item.url } }
          : { image_url: { url: item.url } };
    content.push({ type: item.kind, ...wrapper });
  }
  return [{ role: "user", content }];
}

/** 调用智谱 chat/completions，返回模型文本输出（OpenAI 兼容格式） */
export async function chat(
  prompt: string,
  media: MediaItem[],
  options: ChatOptions = {}
): Promise<string> {
  if (!API_KEY) {
    throw new Error(
      "未配置 ZHIPU_API_KEY：请在 MCP 配置的 env 中填入智谱 API Key（https://open.bigmodel.cn/usercenter/apikeys 获取，glm-4.6v-flash 免费）"
    );
  }
  const body: Record<string, unknown> = {
    model: MODEL,
    messages: buildMessages(prompt, media),
    stream: false,
  };
  if (options.thinking) body.thinking = { type: "enabled" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`请求超时（${TIMEOUT_MS}ms），可调大环境变量 GLM_TIMEOUT_MS`);
    }
    throw new Error(`网络请求失败: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  const raw = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }

  if (!res.ok) {
    throw new Error(`智谱 API 错误 ${res.status}: ${raw.slice(0, 1000)}`);
  }

  const message = data?.choices?.[0]?.message;
  let text = "";
  if (typeof message?.content === "string") {
    text = message.content;
  } else if (Array.isArray(message?.content)) {
    text = message.content
      .map((part: any) => (typeof part === "string" ? part : part?.text ?? JSON.stringify(part)))
      .join("\n");
  } else {
    text = JSON.stringify(data);
  }

  const usage = data?.usage;
  if (usage) {
    text += `\n\n[usage] 输入=${usage.prompt_tokens ?? "-"} tokens，输出=${usage.completion_tokens ?? "-"} tokens`;
  }
  return text;
}