import { translate, type Language } from '../i18n/translate';
// AI 解读（BYOK）：用户配置自己的 LLM API（OpenAI 兼容 chat/completions），
// 一键分析的结构化结果发给用户自己的端点生成自然语言解读。
// 配置仅存本机（localStorage，可选），不经过任何第三方服务器。

export interface AiConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  /** 勾选"记住"才写入 localStorage；否则仅本次会话有效 */
  remember: boolean;
}

export interface AiConfigInput {
  baseUrl: string;
  model: string;
  apiKey: string;
  remember: boolean;
}

export const AI_STORAGE_KEY = 'pcr-workbench.ai.v1';

export const AI_PRESETS: { name: string; baseUrl: string; model: string }[] = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { name: 'SiliconFlow 硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
  { name: '自定义（OpenAI 兼容）', baseUrl: '', model: '' },
];

const CONTROL_RE = /[\u0000-\u001f\u007f-\uffff]/;

/** 校验并清洗配置；非法字段抛错。 */
export function validateAiConfig(input: AiConfigInput): AiConfig {
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[\w.-]+(:\d+)?(\/[\w./-]*)?$/.test(baseUrl)) {
    throw new Error('API 地址须为 https:// 开头的合法 URL');
  }
  const model = input.model.trim();
  if (!model || model.length > 256 || CONTROL_RE.test(model)) throw new Error('请填写模型名称');
  const apiKey = input.apiKey.trim();
  if (!apiKey || apiKey.length > 4096 || CONTROL_RE.test(apiKey)) throw new Error('请填写 API Key');
  return { baseUrl, model, apiKey, remember: !!input.remember };
}

export function loadAiConfig(): AiConfig | null {
  try {
    const raw = localStorage.getItem(AI_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (v?.version !== 1 || typeof v.baseUrl !== 'string' || typeof v.model !== 'string' || typeof v.apiKey !== 'string') {
      return null;
    }
    return { baseUrl: v.baseUrl, model: v.model, apiKey: v.apiKey, remember: true };
  } catch {
    return null;
  }
}

export function saveAiConfig(config: AiConfig): void {
  if (config.remember) {
    localStorage.setItem(AI_STORAGE_KEY, JSON.stringify({ version: 1, baseUrl: config.baseUrl, model: config.model, apiKey: config.apiKey }));
  } else {
    localStorage.removeItem(AI_STORAGE_KEY);
  }
}

export function clearAiConfig(): void {
  localStorage.removeItem(AI_STORAGE_KEY);
}

/** 组装发给模型的解读请求消息。 */
export function buildInterpretMessages(payload: unknown, language: Language = 'zh'): { role: 'system' | 'user'; content: string }[] {
  const t = (message: string) => translate(message, language) + (language === 'en' ? ' ' : '');
  return [
    {
      role: 'system',
      content:
        t('你是一位 qPCR 实验分析专家。用户会给你一份 ΔΔCt 分析的结构化结果（JSON）。') +
        t('请用中文、面向实验人员写一份简明解读，要求：') +
        t('1) 先用两三句话概括实验结论（哪些基因在哪些处理下上调/下调、是否显著）；') +
        t('2) 逐条解读质量报告中的问题（严重/警告），说明其对结果可信度的影响；') +
        t('3) 给出下一步实验或分析建议。') +
        t('用 markdown 小标题组织，总长不超过 500 字。不要复述原始数字表格，只提炼关键结论。'),
    },
    { role: 'user', content: JSON.stringify(payload) },
  ];
}

/** 调用用户自己的 chat/completions 端点，返回解读文本。 */
export async function aiInterpret(config: AiConfig, payload: unknown, signal?: AbortSignal, language: Language = 'zh'): Promise<string> {
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: buildInterpretMessages(payload, language),
      temperature: 0.3,
    }),
    signal,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body?.error?.message || detail;
    } catch {
      /* 保留状态码 */
    }
    throw new Error(`AI 请求失败：${detail}`);
  }
  const body = await res.json();
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('AI 返回了空内容');
  return content;
}

/** 组装一键分析结果的紧凑摘要（控制体积：结果行上限 80）。 */
export function buildInterpretPayload(input: {
  experiment: { controlSamples: string[]; refGenes: string[]; basis?: string };
  report: { score: number; summary: string; issues: { severity: string; message: string }[]; advice: { message: string }[] };
  ntc: { target: string; verdict: string; message: string }[];
  results: {
    target: string;
    sample: string;
    isControl: boolean;
    n: number;
    deltaCt: number | null;
    foldChange: number | null;
    fcSd: number;
    pAdjusted: number | null;
    pValue: number | null;
    significance: string;
  }[];
  warnings: string[];
}): Record<string, unknown> {
  return {
    experiment: input.experiment,
    quality: { score: input.report.score, summary: input.report.summary },
    issues: input.report.issues,
    advice: input.report.advice,
    ntc: input.ntc,
    warnings: input.warnings,
    results: input.results.slice(0, 80),
    resultCount: input.results.length,
  };
}
