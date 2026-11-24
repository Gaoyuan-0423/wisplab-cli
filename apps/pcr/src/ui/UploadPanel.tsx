import { useI18n } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import type { FileMatrixInput } from '../core/merge';
import { readInputFile, sheetToRawMatrix, summarizeSheet, type WorkbookFile } from '../core/parse';
import UiIcon from './UiIcon';

interface Props {
  onBusyChange?: (busy: boolean) => void;
  onLoaded: (fileName: string, sheetName: string, matrix: string[][], file: File) => void;
  onAutoFile: (file: File) => Promise<void>;
  onMergeLoaded: (inputs: FileMatrixInput[], files: File[]) => void;
}

export default function UploadPanel({ onLoaded, onAutoFile, onMergeLoaded, onBusyChange }: Props) {
  const { t } = useI18n();
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [demoBusy, setDemoBusy] = useState('');
  const [pending, setPending] = useState<WorkbookFile | null>(null);
  const [autoMode, setAutoMode] = useState(false);
  const pendingFile = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { onBusyChange?.(busy || !!pending || !!demoBusy); return () => onBusyChange?.(false); }, [busy, pending, demoBusy, onBusyChange]);

  async function handleFiles(files: File[]) {
    setError('');
    if (files.length === 0) return;
    setBusy(true);
    try {
      if (files.length > 1) {
        // 多文件合并模式：每文件取数据最多的工作表
        const inputs: FileMatrixInput[] = [];
        for (const f of files) {
          const parsed = await readInputFile(f);
          let best: { name: string; matrix: string[][] } | undefined;
          if (parsed.kind === 'rdml') {
            best = { name: 'RDML', matrix: parsed.matrix };
          } else {
            best = parsed.sheetNames
              .map((name) => ({ name, matrix: sheetToRawMatrix(parsed.wb, name) }))
              .filter((s) => s.matrix.length > 0)
              .sort((a, b) => b.matrix.length - a.matrix.length)[0];
          }
          if (best) inputs.push({ fileName: f.name, matrix: best.matrix });
        }
        if (inputs.length === 0) {
          setError('文件里没有可读的数据行');
          return;
        }
        onMergeLoaded(inputs, files);
        return;
      }
      const file = files[0];
      if (autoMode) {
        await onAutoFile(file);
        return;
      }
      const parsed = await readInputFile(file);
      if (parsed.kind === 'rdml') {
        onLoaded(file.name, 'RDML', parsed.matrix, file);
        return;
      }
      const nonEmpty = parsed.sheetNames.filter((n) => summarizeSheet(parsed.wb, n).rowCount > 0);
      if (nonEmpty.length === 0) {
        setError('文件里没有可读的数据行');
      } else if (nonEmpty.length === 1) {
        onLoaded(file.name, nonEmpty[0], sheetToRawMatrix(parsed.wb, nonEmpty[0]), file);
      } else {
        pendingFile.current = file;
        setPending(parsed);
      }
    } catch (e) {
      setError(`解析失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setAutoMode(false);
    }
  }

  return (
    <div className="card import-card">
      <div className="import-heading"><div><h2>{t("导入仪器下机结果")}</h2><p className="hint-line">{t("上传导出文件，自动识别列名、孔位和数据。支持单板，也支持多板合并。")}</p></div><span className="format-badge">Excel / CSV / RDML</span></div>
      <div className="import-layout"><div className="import-main">
      <div
        className={`upload-area${dragOver ? ' dragover' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={t("选择仪器结果文件")}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <span className="upload-icon"><UiIcon name="upload" /></span>
        <div className="big">{t("拖入文件，或点击选择")}</div>
        <div className="formats">.xlsx · .xls · .csv · .tsv · .txt · .rdml</div>
        <span className="upload-select">{t("选择文件")}<UiIcon name="arrow" /></span>
        <small>{t("可一次选择多个文件，合并同一实验的多块板")}</small>
      </div>
      <p className="instrument-note">{t("支持 Bio-Rad CFX、QuantStudio / StepOne、LightCycler、Rotor-Gene 等仪器导出，中英文列名与 UTF-8 / GBK 编码自动识别。")}</p>
      </div><aside className="import-shortcuts" aria-label={t("快速开始")}>
      <div className="auto-analysis-intro"><span className="shortcut-icon"><UiIcon name="sparkles" /></span><h3>{t("快速开始")}</h3><p>{t("自动识别列、对照组与内参，直接查看结果和质量报告。")}</p></div>
      <div className="row-actions auto-analysis-action">
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            setAutoMode(true);
            inputRef.current?.click();
          }}
        >
          <UiIcon name="sparkles" />{t("一键智能分析")}<UiIcon name="arrow" />
        </button>
      </div>
      <div className="demo-row">
        <span className="demo-caption">{t("没有文件？用示例体验完整流程")}</span>
        {(
          [
            ['cfx-style.csv', t("CFX 示例")],
            ['quantstudio-style.txt', t("QuantStudio 示例")],
            ['standard-curve-style.csv', t("标准曲线示例")],
          ] as const
        ).map(([file, label]) => (
          <button
            key={file}
            className="small"
            disabled={busy || demoBusy !== ''}
            onClick={() => {
              setDemoBusy(file);
              void (async () => {
                try {
                  const res = await fetch(`./demo/${file}`);
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  const buf = await res.arrayBuffer();
                  await onAutoFile(new File([buf], file));
                } catch (e) {
                  setError(`示例数据加载失败：${e instanceof Error ? e.message : String(e)}`);
                } finally {
                  setDemoBusy('');
                }
              })();
            }}
          >
            {demoBusy === file ? t("加载中…") : label}
            <UiIcon name="arrow" />
          </button>
        ))}
      </div>
      </aside></div>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt,.rdml"
        hidden
        aria-label={t("选择仪器结果文件")}
        multiple
        onChange={(e) => {
          void handleFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      {busy && <div className="parsing">{t("正在解析…")}</div>}
      {error && (
        <p role="alert" style={{ color: 'var(--danger)', marginTop: 10 }}>
          {t(error)}
        </p>
      )}

      {pending && (
        <div className="modal-overlay" role="dialog" aria-label={t("选择工作表")}>
          <div className="modal">
            <h3>{t("选择工作表")}</h3>
            <p className="hint-line">{t('{0} 里有 {1} 个工作表：', [pending.fileName, pending.sheetNames.length])}</p>
            <div className="sheet-list">
              {pending.sheetNames.map((name) => {
                const s = summarizeSheet(pending.wb, name);
                return (
                  <div
                    key={name}
                    className={`sheet-item${s.rowCount === 0 ? '' : ''}`}
                    style={s.rowCount === 0 ? { opacity: 0.45 } : undefined}
                    onClick={() => {
                      if (s.rowCount === 0) return;
                      const wbFile = pending;
                      setPending(null);
                      if (pendingFile.current) onLoaded(wbFile.fileName, name, sheetToRawMatrix(wbFile.wb, name), pendingFile.current);
                      pendingFile.current = null;
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div>📄 {name}</div>
                      <div className="meta">
                        {s.rowCount} {' '}{t("行数据 ·")}{' '}{s.columnCount} {' '}{t("列 · 列名：")}{s.headers.slice(0, 6).join(', ') || '—'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <button onClick={() => setPending(null)}>{t("取消")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
