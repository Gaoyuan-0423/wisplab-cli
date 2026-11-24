import { useI18n } from '../i18n';
import { useState } from 'react';
import {
  AI_PRESETS,
  clearAiConfig,
  saveAiConfig,
  validateAiConfig,
  type AiConfig,
} from '../core/ai';

interface Props {
  config: AiConfig | null;
  onSave: (config: AiConfig | null) => void;
  onClose: () => void;
}

/** AI 解读设置（BYOK）：用户自己的 OpenAI 兼容 API。 */
export default function AiSettingsDialog({ config, onSave, onClose }: Props) {
  const { t } = useI18n();
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? AI_PRESETS[0].baseUrl);
  const [model, setModel] = useState(config?.model ?? AI_PRESETS[0].model);
  const [apiKey, setApiKey] = useState(config?.apiKey ?? '');
  const [remember, setRemember] = useState(!!config?.remember);
  const [error, setError] = useState('');

  function save() {
    try {
      const cleaned = validateAiConfig({ baseUrl, model, apiKey, remember });
      saveAiConfig(cleaned);
      onSave(cleaned);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function pickPreset(name: string) {
    const preset = AI_PRESETS.find((p) => p.name === name);
    if (preset && preset.baseUrl) {
      setBaseUrl(preset.baseUrl);
      setModel(preset.model);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-label={t("AI 解读设置")} onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t("🤖 AI 解读设置")}</h3>
        <p className="hint-line">
          {t("填入你自己的 OpenAI 兼容 API（Key 只保存在本机浏览器，可选\"记住\"）。 只有在你点击\"AI 解读\"时，才会把分析摘要发送到你填写的地址。")}</p>
        <div className="mapping-field" style={{ marginBottom: 10 }}>
          <label>{t("供应商预设")}</label>
          <select value={AI_PRESETS.find((p) => p.baseUrl === baseUrl)?.name ?? AI_PRESETS[4].name} onChange={(e) => pickPreset(e.target.value)} aria-label={t("供应商预设")}>
            {AI_PRESETS.map((p) => (
              <option key={t(p.name)} value={t(p.name)}>
                {t(p.name)}
              </option>
            ))}
          </select>
        </div>
        <div className="mapping-field" style={{ marginBottom: 10 }}>
          <label>{t("API 地址（Base URL）")}</label>
          <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com/v1" />
        </div>
        <div className="mapping-field" style={{ marginBottom: 10 }}>
          <label>{t("模型")}</label>
          <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" />
        </div>
        <div className="mapping-field" style={{ marginBottom: 10 }}>
          <label>API Key</label>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" />
        </div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.86rem', marginBottom: 12 }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          {t("在本机记住 API Key（localStorage，明文保存，公用电脑勿勾选）")}</label>
        {error && (
          <p role="alert" style={{ color: 'var(--danger)', marginBottom: 10 }}>
            {t(error)}
          </p>
        )}
        <div className="row-actions" style={{ justifyContent: 'space-between' }}>
          <button
            className="ghost"
            onClick={() => {
              clearAiConfig();
              onSave(null);
            }}
          >
            {t("清除已存配置")}</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose}>{t("取消")}</button>
            <button className="primary" onClick={save}>
              {t("保存")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
