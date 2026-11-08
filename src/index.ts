#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { chat, resolveSource } from "./glm.js";

const server = new Server(
  {
    name: "mcp-glm-vision",
    version: "1.0.0",
  },
  { capabilities: { tools: {} } }
);

const DEFAULT_IMAGE_PROMPT = "请详细描述这张图片的内容，包括主体、背景、文字和细节。";
const DEFAULT_OCR_PROMPT = "请识别图片中的所有文字，按阅读顺序输出，尽量保留原始排版。";

const TOOLS: Tool[] = [
  {
    name: "analyze_image",
    description:
      "用 GLM-4.6V-Flash（免费视觉模型）分析单张图片。source 可以是本地路径或 http(s) 图片 URL。",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "本地图片路径，或 http(s) 图片链接" },
        prompt: { type: "string", description: "可选：自定义提问，默认详细描述图片" },
        thinking: { type: "boolean", description: "可选：是否开启深度思考（默认 false）" },
      },
      required: ["source"],
    },
  },
  {
    name: "analyze_images",
    description:
      "用 GLM-4.6V-Flash 同时分析多张图片（按顺序传入，2~6 张为宜）。本地路径或 URL 均可。",
    inputSchema: {
      type: "object",
      properties: {
        sources: {
          type: "array",
          items: { type: "string" },
          description: "图片路径或 URL 列表",
        },
        prompt: { type: "string", description: "可选：自定义提问" },
      },
      required: ["sources"],
    },
  },
  {
    name: "analyze_video",
    description: "用 GLM-4.6V-Flash 分析视频（建议用公网可访问的 URL，如 mp4）。",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "视频 URL" },
        prompt: { type: "string", description: "可选：自定义提问，默认总结视频内容" },
      },
      required: ["source"],
    },
  },
  {
    name: "analyze_file",
    description: "用 GLM-4.6V-Flash 分析文件（PDF/文档等，本地路径会自动转成 data URL）。",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "文件路径或 http(s) URL" },
        prompt: { type: "string", description: "可选：自定义提问" },
      },
      required: ["source"],
    },
  },
  {
    name: "ocr_image",
    description: "OCR：识别图片中的文字（适合截图、票据、书页等）。",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "本地图片路径或 URL" },
        prompt: { type: "string", description: "可选：自定义识别要求" },
      },
      required: ["source"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const text = await handleTool(name, (args ?? {}) as Record<string, unknown>);
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `错误: ${message}` }], isError: true };
  }
});

async function handleTool(name: string, args: Record<string, unknown>): Promise<string> {
  const prompt = (args.prompt as string | undefined) ?? "";
  const thinking = Boolean(args.thinking);

  switch (name) {
    case "analyze_image": {
      const source = requireString(args.source, "source");
      const media = [resolveSource(source, "image_url")];
      return chat(prompt || DEFAULT_IMAGE_PROMPT, media, { thinking });
    }
    case "analyze_images": {
      const sources = args.sources;
      if (!Array.isArray(sources) || sources.length === 0) {
        throw new Error("sources 需要是非空数组（图片路径或 URL 列表）");
      }
      if (sources.length > 6) {
        throw new Error("一次最多传 6 张图片，请分批处理");
      }
      const media = sources.map((s) => resolveSource(String(s), "image_url"));
      return chat(prompt || "请依次描述这几张图片的内容，并指出它们之间的关系。", media);
    }
    case "analyze_video": {
      const source = requireString(args.source, "source");
      const media = [resolveSource(source, "video_url")];
      return chat(prompt || "请总结这段视频的内容，包括画面、字幕和关键信息。", media);
    }
    case "analyze_file": {
      const source = requireString(args.source, "source");
      const media = [resolveSource(source, "file_url")];
      return chat(prompt || "请阅读这个文件并总结主要内容。", media);
    }
    case "ocr_image": {
      const source = requireString(args.source, "source");
      const media = [resolveSource(source, "image_url")];
      return chat(prompt || DEFAULT_OCR_PROMPT, media);
    }
    default:
      throw new Error(`未知工具: ${name}`);
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`缺少必填参数 ${name}`);
  }
  return value.trim();
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp-glm-vision] 已启动，模型:", process.env.GLM_MODEL || "glm-4.6v-flash");
}

main().catch((err) => {
  console.error("[mcp-glm-vision] 启动失败:", err);
  process.exit(1);
});