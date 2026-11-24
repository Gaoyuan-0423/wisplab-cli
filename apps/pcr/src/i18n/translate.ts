import { messages } from './messages';
export type Language = 'zh' | 'en';
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function pattern(value: string) {
  const slots: number[] = [];
  const pieces = value.split(/(\{\d+\})/g).map((part) => {
    if (/^\{\d+\}$/.test(part)) { slots.push(Number(part.slice(1, -1))); return '(.*?)'; }
    return escape(part);
  });
  return { expression: new RegExp('^' + pieces.join('') + '$', 's'), slots };
}
const entries = Object.entries(messages);
const templates = entries.filter(([zh]) => /\{\d+\}/.test(zh)).map(([zh, en]) => ({ zh, en, zhPattern: pattern(zh) }));
// Only these slots contain another application message. Other slots are user data.
const nestedSlots: Record<string, number[]> = {
  '已合并 {0} 个文件：{1} 行数据{2}': [2],
  '一键分析完成：质量分 {0}/100 · {1}': [1],
  '解析失败：{0}': [0],
  '示例数据加载失败：{0}': [0],
  '单因素 ANOVA（F={0}, df={1}/{2}）{3}': [3],
  '标准曲线已应用：n={0}，斜率 {1}，R²={2}，效率 {3}%{4}': [4],
};
const interpolate = (value: string, params: readonly unknown[]) => value.replace(/\{(\d+)\}/g, (whole, index) => params[Number(index)] == null ? whole : String(params[Number(index)]));

/** Translate an explicit UI message, never a DOM subtree or arbitrary user field. */
export function translate(source: string, language: Language, params?: readonly unknown[]): string {
  if (language === 'zh') return interpolate(source, params ?? []);
  if (source === '') return '';
  if (Object.hasOwn(messages, source)) return interpolate(messages[source], params ?? []);
  if (params) return interpolate(source, params);
  // Stored reports keep their original Chinese messages; translate at presentation time.
  for (const item of templates) {
    const sourcePattern = item.zhPattern;
    const match = sourcePattern.expression.exec(source);
    if (!match) continue;
    const values: string[] = [];
    sourcePattern.slots.forEach((slot, index) => { values[slot] = match[index + 1]; });
    for (const slot of nestedSlots[item.zh] ?? []) values[slot] = translate(values[slot] ?? '', language);
    return interpolate(item.en, values);
  }
  // NTC warnings prefix the unchanged user-supplied target name.
  const ntcWarning = /^(.*)：(NTC .*)$/s.exec(source);
  if (ntcWarning) return ntcWarning[1] + ': ' + translate(ntcWarning[2], language);
  // Statistical method suffixes are generated separately by the unchanged engine.
  for (const suffix of ['；FC 经 Pfaffl 效率校正', '；Dunnett vs 对照']) {
    if (source.endsWith(suffix)) return translate(source.slice(0, -suffix.length), language) + messages[suffix];
  }
  if (source.startsWith('无法计算 ΔΔCt：')) return messages['无法计算 ΔΔCt：'] + translate(source.slice('无法计算 ΔΔCt：'.length), language);
  return source;
}

