import { connectProjectAdapter, decodeJson, encodeJson } from './project-archive';
import { exportPcrProject, importPcrProject, recoverLegacyNumbers, type PcrProjectState as ProjectState } from './project-io';
import { LanguageSwitch, withLanguage, useI18n } from './i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { del, get, set } from 'idb-keyval';
import { analyzeDeltaDeltaCt, extractRows, guessRefGenes, isNtcRow, isStandardRow, type AnalysisRow } from './core/analysis';
import { analyzeFileAuto, inferExperiment, type QualityReport } from './core/auto';
import type { MeltGeneSummary, MeltTableState } from './core/melt';
import { parseMeltSummaryTable } from './core/melt';
import { readInputFile, sheetToRawMatrix } from './core/parse';
import { mergeFileMatrices, type FileMatrixInput, type PerFileInfo } from './core/merge';
import MergeSummaryPanel from './ui/MergeSummaryPanel';
import ProjectsDialog from './ui/ProjectsDialog';
import { computeQcFlags } from './core/qc';
import { sniff } from './core/sniff';
import { mappingComplete, DEFAULT_QC, emptyMapping, type AnalysisConfig, type ColumnMapping, type QcFlags } from './core/types';
import UploadPanel from './ui/UploadPanel';
import MappingPanel from './ui/MappingPanel';
import ConfigPanel from './ui/ConfigPanel';
import ResultsPanel from './ui/ResultsPanel';
import { StepHelp } from './ui/StepHelp';
import { AiInterpretCard } from './ui/AiInterpretCard';
import AiSettingsDialog from './ui/AiSettingsDialog';
import UiIcon from './ui/UiIcon';
import { loadAiConfig, type AiConfig } from './core/ai';
import {
  deleteProject,
  listProjects,
  loadProjectState,
  newProjectId,
  renameProject,
  saveProject,
  type ProjectMeta,
} from './core/projects';

const idbKv = { get, set, del };

const STORAGE_KEY = 'pcr-workbench:project:v1';
const LAST_KEY = 'pcr-workbench:last:v1';
const suiteHost = window.location.hostname.toLowerCase();
const isDesktop = window.location.protocol === 'app:' || (window as Window & { wispLabDesktop?: { isDesktop?: boolean } }).wispLabDesktop?.isDesktop === true;
const platformHome = isDesktop ? 'app://wisplab/' : 'https://wisplab.top/';
const isWispLab = isDesktop || suiteHost === 'wisplab.top' || suiteHost.endsWith('.wisplab.top');
const suiteLinks = {
  wb: isDesktop ? 'app://wisplab/wb/' : isWispLab ? 'https://wb.wisplab.top/' : 'https://gaoyuan-0423.github.io/blot-workbench/',
  pathology: isDesktop ? 'app://wisplab/pathology/' : isWispLab ? 'https://pathology.wisplab.top/' : 'https://gaoyuan-0423.github.io/pathology-workbench/',
  pcr: isDesktop ? 'app://wisplab/pcr/' : isWispLab ? 'https://pcr.wisplab.top/' : 'https://gaoyuan-0423.github.io/pcr-workbench/',
};


const STEPS = ['导入数据', '确认映射', '孔板与配置', '分析结果'];
const STEP_NOTES = ['上传仪器导出文件', '核对自动识别的列', '检查复孔和实验设置', '查看结果与导出图表'];

export default function App() {
  const { t, language } = useI18n();
  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [matrix, setMatrix] = useState<string[][]>([]);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>(emptyMapping());
  const [excluded, setExcluded] = useState<Record<number, boolean>>({});
  const [config, setConfig] = useState<AnalysisConfig>({ controlSamples: [], refGenes: [], qc: DEFAULT_QC });
  const [toast, setToast] = useState('');
  const [restored, setRestored] = useState(false);
  const [autoReport, setAutoReport] = useState<QualityReport | null>(null);
  const [autoMelt, setAutoMelt] = useState<MeltGeneSummary[]>([]);
  const [meltTable, setMeltTable] = useState<MeltTableState | null>(null);
  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null);
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [guessBasis, setGuessBasis] = useState('');
  const [merged, setMerged] = useState<{ rows: AnalysisRow[]; perFile: PerFileInfo[] } | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [showProjects, setShowProjects] = useState(false);
  const [projectList, setProjectList] = useState<ProjectMeta[]>([]);
  /** 用户已主动加载过数据（新表/示例）——挂载恢复必须让位于用户操作 */
  const userLoadedRef = useRef(false);
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [meltFile, setMeltFile] = useState<File | null>(null);
  const [inputMatrices, setInputMatrices] = useState<FileMatrixInput[]>([]);
  const [sourceBundleId, setSourceBundleId] = useState('');
  const [projectGaps, setProjectGaps] = useState<string[]>([]);
  const snapshotRef = useRef<ProjectState | null>(null);
  const importBusyRef = useRef(false);
  const onImportBusy = useCallback((busy: boolean) => { importBusyRef.current = busy; }, []);
  const projectSnapshot = useMemo<ProjectState>(() => ({ fileName, sheetName, matrix, headerRow, mapping, excluded, config, merged, autoReport, autoMelt, meltTable, inputMatrices, sourceFiles, meltFile, projectName, step, guessBasis, sourceBundleId }), [fileName, sheetName, matrix, headerRow, mapping, excluded, config, merged, autoReport, autoMelt, meltTable, inputMatrices, sourceFiles, meltFile, projectName, step, guessBasis, sourceBundleId]);
  snapshotRef.current = projectSnapshot;
  const translateRef = useRef(t); translateRef.current = t;

  useEffect(() => {
    if (!sourceBundleId) return;
    void set(`pcr-workbench:sources:${sourceBundleId}`, { sourceFiles, meltFile });
  }, [sourceBundleId, sourceFiles, meltFile]);

  useEffect(() => {
    let mounted = true;
    const dispose = connectProjectAdapter({
    tool: 'pcr',
    exportProject: async () => {
      if (importBusyRef.current) throw new Error(t('请等待当前导入完成'));
      const state = snapshotRef.current!;
      const result = await exportPcrProject(state);
      return { blob: result.blob, name: `${(state.projectName || state.fileName || 'PCR project').replace(/\.[^.]+$/, '')}.wisplab.zip`, format: 'wisplab-pcr-v1.zip', summaryTranslations: { zh: result.completeness.join('\n') || '包含原文件、表格及配置', en: result.completeness.join('\n') || 'Includes original files, tables and settings' }, summary: result.completeness.length ? result.completeness.join('\n') : '包含原文件、表格及配置 / Includes original files, tables and settings' };
    },
    importProject: async (blob, options) => {
      const before = snapshotRef.current;
      const current = () => mounted && options?.isCurrent?.() !== false && snapshotRef.current === before;
      const { project: state, completeness } = await importPcrProject(blob);
      if (!current()) throw new DOMException('Cancelled', 'AbortError');
      if (importBusyRef.current) throw new Error(translateRef.current('请等待当前导入完成'));
      if (!window.confirm(translateRef.current('打开此版本会替换当前工作内容，是否继续？') + (completeness.length ? '\n\n' + completeness.join('\n') : ''))) throw new DOMException('Cancelled', 'AbortError');
      if (!current()) throw new DOMException('Cancelled', 'AbortError');
      userLoadedRef.current = true;
      setFileName(state.fileName); setSheetName(state.sheetName); setMatrix(state.matrix); setHeaderRow(state.headerRow); setMapping(state.mapping); setExcluded(state.excluded); setConfig(state.config);
      setMerged(state.merged ?? null); setAutoReport(state.autoReport ?? null); setAutoMelt(state.autoMelt ?? []); setMeltTable(state.meltTable ?? null); setInputMatrices(state.inputMatrices ?? []);
      setSourceFiles(state.sourceFiles ?? []); setMeltFile(state.meltFile ?? null); setSourceBundleId(crypto.randomUUID());
      setProjectId(null); setProjectName(state.projectName ?? state.fileName); setGuessBasis(state.guessBasis ?? ''); setStep(state.step ?? 4); setRestored(true); setProjectGaps(completeness);
      setToast(t('项目已恢复；历史缺失附件不会自动补全。'));
    },
    });
    return () => { mounted = false; dispose(); };
  }, []);

  // 恢复优先级：localStorage 同步镜像（最新，见下方镜像写入）> 最近课题；
  // 异步恢复期间用户可能已拖入新文件——已加载则放弃恢复，避免旧数据覆盖新上传
  useEffect(() => {
    setAiConfig(loadAiConfig());
    void (async () => {
      let list = await listProjects(idbKv);
      const legacy = await get<ProjectState>(STORAGE_KEY);
      if (legacy && ((legacy.matrix?.length ?? 0) > 0 || (legacy.merged?.rows?.length ?? 0) > 0)) {
        const id = newProjectId();
        const migration: ProjectMeta = {
          id,
          name: legacy.fileName || '未命名课题',
          updatedAt: Date.now(),
          fileName: legacy.fileName,
          score: null,
          rows: legacy.merged?.rows?.length ?? legacy.matrix?.length ?? 0,
        };
        await saveProject(idbKv, migration, legacy);
        await del(STORAGE_KEY);
        list = await listProjects(idbKv);
      }
      if (userLoadedRef.current) return; // 用户已换新表，放弃恢复

      // 1) 同步镜像优先（刷新必然拿到最新工作状态）
      let restoredState: ProjectState | null = null;
      let restoredMeta: ProjectMeta | null = null;
      try {
        const raw = localStorage.getItem(LAST_KEY);
        if (raw) {
          const mirror = decodeJson(raw) as ProjectState & { id: string | null };
          // 镜像挂在一个已被删除的课题上 → 不复活
          if (!mirror.id || list.some((m) => m.id === mirror.id)) {
            restoredState = mirror;
            restoredMeta = list.find((m) => m.id === mirror.id) ?? null;
            if (mirror.id && !restoredMeta) {
              restoredMeta = { id: mirror.id, name: mirror.fileName || '未命名课题', updatedAt: Date.now(), fileName: mirror.fileName, score: null, rows: mirror.merged?.rows?.length ?? mirror.matrix.length };
            }
          } else {
            localStorage.removeItem(LAST_KEY);
          }
        }
      } catch {
        /* 镜像损坏则忽略 */
      }

      // 2) 回落：课题索引里的最近一条
      if (!restoredState && list.length > 0) {
        const recent = list[0];
        restoredState = (await loadProjectState<ProjectState>(idbKv, recent.id)) ?? null;
        restoredMeta = recent;
      }

      if (userLoadedRef.current) return; // 双重检查
      if (!restoredState) return;
      restoredState = recoverLegacyNumbers(restoredState);
      if (restoredState.sourceBundleId) {
        const sources = await get<{ sourceFiles: File[]; meltFile: File | null }>(`pcr-workbench:sources:${restoredState.sourceBundleId}`);
        if (sources) restoredState = { ...restoredState, ...sources };
      }
      if (userLoadedRef.current) return;
      setSourceFiles(restoredState.sourceFiles ?? []); setMeltFile(restoredState.meltFile ?? null); setSourceBundleId(restoredState.sourceBundleId ?? '');
      setInputMatrices(restoredState.inputMatrices ?? []); setMeltTable(restoredState.meltTable ?? null); setGuessBasis(restoredState.guessBasis ?? '');
      setProjectId(restoredMeta?.id ?? null);
      setProjectName(restoredMeta?.name ?? '');
      setFileName(restoredState.fileName);
      setSheetName(restoredState.sheetName);
      setMatrix(restoredState.matrix);
      setHeaderRow(restoredState.headerRow);
      setMapping(restoredState.mapping);
      setExcluded(restoredState.excluded ?? {});
      setConfig(restoredState.config);
      setMerged(restoredState.merged ?? null);
      setAutoReport(restoredState.autoReport ?? null);
      setAutoMelt(restoredState.autoMelt ?? []);
      setProjectList(list);
      setRestored(true);
      setStep(4);
    })();
  }, []);

  function refreshProjectList(): void {
    void listProjects(idbKv).then(setProjectList);
  }

  // 自动保存到当前课题（防抖）；页面隐藏/关闭时立即落盘，避免快速刷新丢最新数据
  const saveNow = useCallback(() => {
    if (matrix.length === 0 && !merged) return;
    void (async () => {
      let id = projectId;
      if (!id) {
        id = newProjectId();
        setProjectId(id);
      }
      const state: ProjectState = snapshotRef.current!;
      const meta: ProjectMeta = {
        id,
        name: projectName || fileName || '未命名课题',
        updatedAt: Date.now(),
        fileName,
        score: autoReport?.score ?? null,
        rows: merged?.rows.length ?? matrix.length ? (merged ? merged.rows.length : matrix.slice(headerRow + 1).length) : 0,
      };
      await saveProject(idbKv, meta, state);
      setProjectList(await listProjects(idbKv));
    })();
  }, [fileName, sheetName, matrix, headerRow, mapping, excluded, config, merged, projectId, projectName, autoReport, autoMelt, meltTable, sourceFiles, meltFile, inputMatrices, sourceBundleId, step, guessBasis]);

  // 同步镜像：每次状态变化立即写 localStorage（同步 API，刷新必然拿到最新）。
  // IDB 的防抖保存负责课题列表；镜像负责"当前工作状态"的可靠恢复。
  useEffect(() => {
    if (matrix.length === 0 && !merged) return;
    try {
      localStorage.setItem(
        LAST_KEY,
        encodeJson({
          fileName,
          sheetName,
          matrix,
          headerRow,
          mapping,
          excluded,
          config,
          merged,
          autoReport,
          autoMelt,
          meltTable, inputMatrices, sourceBundleId, projectName, step, guessBasis,
          id: projectId,
        } satisfies ProjectState & { id: string | null }),
      );
    } catch {
      // 超出 localStorage 配额（超大表）时跳过——IDB 防抖保存仍兜底
    }
  }, [fileName, sheetName, matrix, headerRow, mapping, excluded, config, merged, projectId, autoReport, autoMelt, meltTable, inputMatrices, sourceBundleId, projectName, step, guessBasis]);

  useEffect(() => {
    if (matrix.length === 0 && !merged) return;
    const t = setTimeout(saveNow, 600);
    return () => clearTimeout(t);
  }, [matrix, merged, saveNow]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') saveNow();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, [saveNow]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const handleMergeLoaded = useCallback((inputs: FileMatrixInput[], files: File[]) => {
    setSourceFiles(files); setMeltFile(null); setInputMatrices(inputs); setSourceBundleId(crypto.randomUUID()); setProjectGaps([]);
    userLoadedRef.current = true;
    const m = mergeFileMatrices(inputs);
    const genes = [...new Set(m.rows.map((r) => r.target).filter(Boolean))];
    setFileName(inputs.map((i) => i.fileName).join(' + '));
    setSheetName('');
    setMatrix([]);
    setHeaderRow(0);
    setMapping(emptyMapping());
    setMerged(m);
    setExcluded({});
    // 合并流程同样自动推断对照组与常见内参
    const samples = [...new Set(m.rows.filter((r) => !isNtcRow(r) && !isStandardRow(r)).map((r) => r.sample).filter(Boolean))].sort();
    const guess = inferExperiment(samples, genes);
    setConfig({
      controlSamples: guess.controlSamples,
      refGenes: guess.refGenes,
      qc: DEFAULT_QC,
    });
    setAutoReport(null);
    setAutoMelt([]);
    setMeltTable(null);
    setProjectId(null);
    setProjectName('');
    setGuessBasis(guess.basis);
    setRestored(false);
    setStep(2);
    setToast(`已合并 ${inputs.length} 个文件：${m.rows.length} 行数据${guess.controlSamples.length ? `，自动推断对照组 ${guess.controlSamples.length} 个样本` : '，请手动指定对照组'}`);
  }, []);

  const handleMeltTableFile = useCallback(async (file: File) => {
    importBusyRef.current = true;
    try {
    const parsed = await readInputFile(file);
    const matrix =
      parsed.kind === 'rdml'
        ? parsed.matrix
        : (parsed.sheetNames
            .map((name) => sheetToRawMatrix(parsed.wb, name))
            .filter((m) => m.length > 0)
            .sort((a, b) => b.length - a.length)[0] ?? []);
    const byWell = parseMeltSummaryTable(matrix);
    if (!byWell) {
      setToast('未能识别为熔解摘要表（需要 孔位 Pos/Well + 峰值数 No. Tm 列）');
      return;
    }
    setMeltTable({ fileName: file.name, byWell: Object.fromEntries(byWell) });
    setMeltFile(file); setSourceBundleId(crypto.randomUUID());
    setToast(`已附加熔解摘要表：${byWell.size} 个孔位`);
    } finally { importBusyRef.current = false; }
  }, []);

  const handleAutoFile = useCallback(async (file: File) => {
    userLoadedRef.current = true;
    const result = await analyzeFileAuto(file);
    setSourceFiles([file]); setMeltFile(null); setMeltTable(null); setInputMatrices([]); setSourceBundleId(crypto.randomUUID()); setProjectGaps([]); setMerged(null);
    setFileName(result.fileName);
    setSheetName(result.sheetName);
    setMatrix(result.matrix);
    setHeaderRow(result.headerRow);
    setMapping(result.mapping);
    setExcluded({});
    setConfig(result.config);
    setAutoReport(result.report);
    setAutoMelt(result.melt ?? []);
    setProjectId(null);
    setProjectName('');
    setGuessBasis(result.guess.basis);
    setRestored(false);
    setStep(4);
    setToast(`一键分析完成：质量分 ${result.report.score}/100 · ${result.report.summary}`);
  }, []);

  const handleLoaded = useCallback((name: string, sheet: string, m: string[][], file: File) => {
    setSourceFiles([file]); setMeltFile(null); setMeltTable(null); setInputMatrices([]); setSourceBundleId(crypto.randomUUID()); setProjectGaps([]); setMerged(null); setAutoReport(null); setAutoMelt([]);
    userLoadedRef.current = true;
    const s = sniff(m);
    setFileName(name);
    setSheetName(sheet);
    setMatrix(m);
    setHeaderRow(s.headerRow);
    setMapping(s.mapping);
    setExcluded({});
    const rows = extractRows(m.slice(s.headerRow + 1), s.mapping);
    const genes = [...new Set(rows.map((r) => r.target).filter(Boolean))];
    setConfig({
      controlSamples: [],
      refGenes: guessRefGenes(genes),
      qc: DEFAULT_QC,
    });
    setProjectId(null);
    setProjectName('');
    setRestored(false);
    setStep(2);
    setToast(`已解析 ${name}（${sheet}）：${rows.length} 行数据，自动映射完成，请确认`);
  }, []);

  const rows = useMemo(
    () =>
      merged
        ? merged.rows.map((r) => ({ ...r, excluded: excluded[r.id] ?? false }))
        : matrix.length
          ? extractRows(matrix.slice(headerRow + 1), mapping).map((r) => ({
              ...r,
              excluded: excluded[r.id] ?? false,
            }))
          : [],
    [merged, matrix, headerRow, mapping, excluded],
  );

  const flags: QcFlags = useMemo(
    () =>
      computeQcFlags(
        rows
          .filter((r) => !isNtcRow(r))
          .map((r) => ({ id: r.id, sample: r.sample, target: r.target, cq: r.cq, excluded: r.excluded })),
        config.qc,
      ),
    [rows, config.qc],
  );

  const out = useMemo(
    () => (rows.length ? analyzeDeltaDeltaCt(rows, config) : null),
    [rows, config],
  );

  const canGoConfig = merged
    ? merged.perFile.some((f) => f.ok) && merged.rows.length > 0
    : mappingComplete(mapping);
  const canGoResults =
    canGoConfig && config.controlSamples.length > 0 && config.refGenes.length > 0 && !!out && out.results.length > 0;

  function goto(n: number) {
    if (n >= 2 && !canGoConfig) {
      setToast('请先完成列映射');
      return;
    }
    if (n >= 4 && !canGoResults) {
      // 配置齐全但没有结果 → 把引擎的真实告警（如内参未检出）说清楚
      if (config.controlSamples.length > 0 && config.refGenes.length > 0 && out && out.results.length === 0 && out.warnings.length > 0) {
        setToast('无法计算 ΔΔCt：' + out.warnings[0]);
      } else {
        setToast('请先设置对照组样本和内参基因');
      }
      return;
    }
    setStep(n);
  }

  function reset() {
    userLoadedRef.current = true;
    setSourceFiles([]); setMeltFile(null); setInputMatrices([]); setSourceBundleId(''); setProjectGaps([]);
    setFileName('');
    setSheetName('');
    setMatrix([]);
    setHeaderRow(0);
    setMapping(emptyMapping());
    setExcluded({});
    setConfig({ controlSamples: [], refGenes: [], qc: DEFAULT_QC });
    setAutoReport(null);
    setAutoMelt([]);
    setMeltTable(null);
    setGuessBasis('');
    setMerged(null);
    setProjectId(null);
    setProjectName('');
    localStorage.removeItem(LAST_KEY); // 新建课题：清掉当前工作镜像，防止刷新后复活旧内容
    setRestored(false);
    setStep(1);
  }

  return (
    <div className="app-shell">
      <div className="suite-bar">
        <div className={`suite-bar-inner${isWispLab ? ' suite-with-home' : ''}`}>
          <a className="suite-brand" href={withLanguage(platformHome, language)}><span className="suite-mark" aria-hidden="true"><UiIcon name="grid" /></span><span>{t("WispLab实验数据分析")}</span></a>
          <nav className="suite-nav" aria-label={t("实验工作台导航")}>
            {isWispLab && <a href={withLanguage(platformHome, language)}>{t("总首页")}</a>}
            <a href={withLanguage(suiteLinks.wb, language)}>WB</a>
            <a href={withLanguage(suiteLinks.pathology, language)}>{t("病理")}</a>
            <a href={withLanguage(suiteLinks.pcr, language)} aria-current="page">PCR</a>
          </nav>
          <LanguageSwitch />
        </div>
      </div>
      <main className="container">
      <header className="app-header">
        <div className="app-title">
          <span className="app-eyebrow">PCR WORKBENCH</span>
          <h1>{t("PCR 工作台")}</h1>
          <p className="sub">{t("从仪器下机数据，到清晰的表达量结果与科研图表。")}</p>
        </div>
        <div className="header-tools">
          <div className="header-actions">
            <button onClick={() => { refreshProjectList(); setShowProjects(true); }}><UiIcon name="folder" />{t("我的课题")}</button>
            <button onClick={() => setShowAiSettings(true)}><UiIcon name="settings" />{t("AI 设置")}</button>
          </div>
          <span className="privacy-note"><UiIcon name="shield" />{t("数据在浏览器中解析与计算")}</span>
        </div>
      </header>
      {projectGaps.length > 0 && <div className="card" role="status"><strong>{t("项目完整性说明")}</strong><ul>{projectGaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul></div>}
      {projectName && <div className="current-project"><UiIcon name="folder" /><span>{t("当前课题")}</span><strong title={projectName}>{projectName}</strong></div>}
      {showProjects && (
        <ProjectsDialog
          currentId={projectId}
          projects={projectList}
          onClose={() => setShowProjects(false)}
          onNew={() => {
            setShowProjects(false);
            reset();
          }}
          onOpen={(id) => {
            void (async () => {
              const meta = projectList.find((m) => m.id === id);
              const savedState = await loadProjectState<ProjectState>(idbKv, id);
              if (!savedState) return;
              const state = recoverLegacyNumbers(savedState);
              userLoadedRef.current = true;
              setSourceFiles(state.sourceFiles ?? []); setMeltFile(state.meltFile ?? null); setInputMatrices(state.inputMatrices ?? []); setSourceBundleId(state.sourceBundleId ?? ''); setProjectGaps([]);
              setShowProjects(false);
              setProjectId(id);
              setProjectName(meta?.name ?? state.fileName);
              setFileName(state.fileName);
              setSheetName(state.sheetName);
              setMatrix(state.matrix);
              setHeaderRow(state.headerRow);
              setMapping(state.mapping);
              setExcluded(state.excluded ?? {});
              setConfig(state.config);
              setMerged(state.merged ?? null);
              setAutoReport(state.autoReport ?? null);
              setAutoMelt(state.autoMelt ?? []);
              setMeltTable(state.meltTable ?? null);
              setRestored(true);
              setStep(4);
              setToast(`已打开课题「${meta?.name ?? state.fileName}」`);
            })();
          }}
          onRename={(id, name) => {
            void renameProject(idbKv, id, name);
            if (id === projectId) setProjectName(name);
            refreshProjectList();
          }}
          onDelete={(id) => {
            void deleteProject(idbKv, id).then(refreshProjectList);
            if (id === projectId) {
              setProjectId(null);
              setProjectName('');
              reset();
            }
          }}
        />
      )}
      {showAiSettings && (
        <AiSettingsDialog
          config={aiConfig}
          onClose={() => setShowAiSettings(false)}
          onSave={(c) => {
            setAiConfig(c);
            setShowAiSettings(false);
            setToast(c ? 'AI 配置已保存' : '已清除 AI 配置');
          }}
        />
      )}

      <nav className="steps" aria-label={t("分析步骤")}>
        {STEPS.map((label, i) => {
          const n = i + 1;
          const cls = n === step ? 'step active' : n < step ? 'step done' : 'step';
          return (
            <button
              key={label}
              className={cls}
              style={{ cursor: n < step ? 'pointer' : 'default' }}
              onClick={() => n !== step && goto(n)}
              aria-current={n === step ? 'step' : undefined}
            >
              <span className="num">{n < step ? '✓' : n}</span>
              <span className="step-copy"><span>{t(label)}</span><small aria-hidden="true">{t(STEP_NOTES[i])}</small></span>
            </button>
          );
        })}
      </nav>

      {restored && (
        <div className="warning-banner">
          {t('已恢复上次的项目「{0}」。要重新开始，', [fileName])}<button className="small ghost" onClick={reset}>
            {t("点此清空")}</button>
          {language === 'en' ? '.' : '。'}
        </div>
      )}

      {step === 1 && (
        <>
          <UploadPanel onBusyChange={onImportBusy} onLoaded={handleLoaded} onAutoFile={handleAutoFile} onMergeLoaded={handleMergeLoaded} />
          <StepHelp step={1} />
        </>
      )}
      {step === 2 &&
        (merged ? (
          <>
            <MergeSummaryPanel perFile={merged.perFile} />
            <StepHelp step={2} />
          </>
        ) : (
          <>
            <MappingPanel
              matrix={matrix}
              headerRow={headerRow}
              mapping={mapping}
              onHeaderRow={setHeaderRow}
              onMapping={setMapping}
            />
            <StepHelp step={2} />
          </>
        ))}
      {step === 3 && (
        <>
          <ConfigPanel
            rows={rows}
            flags={flags}
            config={config}
            onConfig={setConfig}
            excluded={excluded}
            onExcluded={setExcluded}
            meltTable={meltTable}
            onMeltTableFile={handleMeltTableFile}
          />
          <StepHelp step={3} />
        </>
      )}
      {step === 4 && out && (
        <>
          <ResultsPanel out={out} fileName={fileName} rows={rows} flags={flags} autoReport={autoReport} guessBasis={guessBasis} autoMelt={autoMelt} />
          <StepHelp step={4} />
          <AiInterpretCard
            aiConfig={aiConfig}
            onOpenSettings={() => setShowAiSettings(true)}
            payload={{
              experiment: {
                controlSamples: config.controlSamples,
                refGenes: config.refGenes,
                basis: guessBasis || undefined,
              },
              report: {
                score: autoReport?.score ?? 100,
                summary: autoReport?.summary ?? '',
                issues: autoReport?.issues ?? [],
                advice: autoReport?.advice ?? [],
              },
              ntc: out.ntcReport.map((e) => ({ target: e.target, verdict: e.verdict, message: e.message })),
              melt: autoMelt,
              results: out.results.map((r) => ({
                target: r.target,
                sample: r.sample,
                group: r.group,
                isControl: r.isControl,
                n: r.n,
                deltaCt: r.deltaCt,
                foldChange: r.foldChange,
                fcSd: r.fcSd,
                pDunnett: r.pAdjusted,
                pValue: r.pValue,
                significance: r.significance,
              })),
              warnings: out.warnings,
            }}
          />
        </>
      )}

      <div className="row-actions workflow-actions">
        <span>{step > 1 && <button onClick={() => setStep(step - 1)}>{t("← 上一步")}</button>}</span>
        <span>
          {step === 2 && (
            <button className="primary" disabled={!canGoConfig} onClick={() => goto(3)}>
              {t("下一步：孔板与配置 →")}</button>
          )}
          {step === 3 && (
            <button
              className="primary"
              disabled={!config.controlSamples.length || !config.refGenes.length}
              onClick={() => goto(4)}
            >
              {t("计算 ΔΔCt 并查看结果 →")}</button>
          )}
        </span>
      </div>

      {toast && (
        <div className="toast" role="status">
          {t(toast)}
        </div>
      )}
      <footer className="app-footer"><span>{t("WispLab实验数据分析")}</span><span>{t("本地分析 · 课题自动保存 · 结果随时导出")}</span></footer>
      </main>
    </div>
  );
}
