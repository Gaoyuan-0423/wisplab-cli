import { useI18n } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import type { MeltGeneSummary } from '../core/melt';
import type { QualityReport } from '../core/auto';
import type { AiConfig } from '../core/ai';

/** AI 解读卡片（结果页，BYOK：用户自己的 OpenAI 兼容 API）。 */
export function AiInterpretCard({
  aiConfig,
  onOpenSettings,
  payload,
}: {
  aiConfig: AiConfig | null;
  onOpenSettings: () => void;
  payload: {
    experiment: { controlSamples: string[]; refGenes: string[]; basis?: string };
    report: Pick<QualityReport, 'score' | 'summary' | 'issues' | 'advice'>;
    ntc: { target: string; verdict: string; message: string }[];
    melt?: MeltGeneSummary[];
    results: unknown[];
    warnings: string[];
  };
}) {
  const { t, language } = useI18n();
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function run() {
    setError('');
    setAnswer('');
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { aiInterpret } = await import('../core/ai');
      const text = await aiInterpret(aiConfig!, payload, controller.signal, language);
      setAnswer(text);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>
        {t("🤖 AI 解读")}<span className="hint">{t("用你自己的 API Key，把分析摘要交给模型生成自然语言解读")}</span>
      </h2>
      {!aiConfig ? (
        <div>
          <p className="hint-line">
            {t("还没有配置 AI。点下方按钮填入你自己的 API 地址、模型与 Key（DeepSeek / OpenAI / Kimi 等任意 OpenAI 兼容服务）。Key 只保存在你的浏览器里；仅在你点击\"开始解读\"时，才会把")}<strong>{t("分析摘要")}</strong>{t("（结构化结论，不含原始荧光数据）发送到你填写的地址。")}</p>
          <button className="primary" onClick={onOpenSettings}>
            {t("配置我的 API")}</button>
        </div>
      ) : (
        <div>
          <div className="results-toolbar">
            <span className="hint-line" style={{ margin: 0 }}>
              {t("模型")}{' '}<code>{aiConfig.model}</code> @{' '}
              <code>{aiConfig.baseUrl.replace(/^https:\/\//, '')}</code>
            </span>
            <span style={{ flex: 1 }} />
            <button onClick={onOpenSettings}>{t("修改设置")}</button>
            <button className="primary" disabled={busy} onClick={run}>
              {busy ? t("解读中…") : answer ? t("重新解读") : t("开始解读")}
            </button>
            {busy && (
              <button
                onClick={() => {
                  abortRef.current?.abort();
                }}
              >
                {t("停止")}</button>
            )}
          </div>
          {error && (
            <p role="alert" style={{ color: 'var(--danger)' }}>
              {t(error)}
            </p>
          )}
          {answer && (
            <div className="ai-answer">
              {answer.split('\n').map((line, i) => {
                const t = line.trim();
                if (t.startsWith('###')) return <h4 key={i}>{t.replace(/^#+\s*/, '')}</h4>;
                if (t.startsWith('##') || t.startsWith('#')) return <h3 key={i}>{t.replace(/^#+\s*/, '')}</h3>;
                if (/^[-*]\s/.test(t))
                  return (
                    <p key={i} style={{ paddingLeft: 16 }}>
                      • {t.replace(/^[-*]\s*/, '')}
                    </p>
                  );
                return <p key={i}>{line}</p>;
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
