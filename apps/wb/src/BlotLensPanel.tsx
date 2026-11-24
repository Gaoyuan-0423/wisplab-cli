import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, Upload } from "lucide-react";
import { useLanguage } from "./i18n";
import "./blotlens.css";

const source = "./blotlens/index.html";
const messages = {
  loading: ["正在载入截图…", "Loading screenshot…"],
  loaded: ["截图已载入。", "Screenshot loaded."],
  invalid: ["请选择 15 MB 以内的 PNG/JPEG 截图。", "Choose a PNG or JPEG screenshot up to 15 MB."],
  failed: ["导入失败，请在下方查看详情或直接导入。", "Import failed. See the review panel below or import the image there."],
} as const;

export default function BlotLensPanel({ active }: { active: boolean }) {
  const { language, t, href } = useLanguage();
  const frame = useRef<HTMLIFrameElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [hasAnalysis, setHasAnalysis] = useState(false);
  const [status, setStatus] = useState<keyof typeof messages | null>(null);

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.version !== 1) return;
      switch (event.data.type) {
        case "blotlens:ready":
          setReady(true);
          break;
        case "blotlens:state":
          if (typeof event.data.hasAnalysis === "boolean") setHasAnalysis(event.data.hasAnalysis);
          break;
        case "blotlens:import-result":
          if (pending.current && event.data.requestId === pending.current) {
            clearTimeout(timer.current);
            pending.current = null;
            setStatus(event.data.ok ? "loaded" : "failed");
          }
      }
    }
    window.addEventListener("message", receive);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("message", receive);
    };
  }, []);
  useEffect(() => {
    if (ready) frame.current?.contentWindow?.postMessage({ type: "blotlens:language", version: 1, language }, location.origin);
  }, [ready, language]);
  useEffect(() => {
    if (!hasAnalysis) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [hasAnalysis]);

  async function sendImage(file: File) {
    clearTimeout(timer.current);
    pending.current = null;
    if (!ready || !frame.current?.contentWindow) return;
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size === 0 || file.size > 15 * 1024 * 1024) {
      setStatus("invalid");
      return;
    }
    const requestId = crypto.randomUUID();
    pending.current = requestId;
    setStatus("loading");
    try {
      const bytes = await file.arrayBuffer();
      if (pending.current !== requestId) return;
      frame.current?.contentWindow?.postMessage({
        type: "blotlens:import-image", version: 1, requestId, name: file.name, mimeType: file.type, bytes,
      }, location.origin, [bytes]);
      timer.current = setTimeout(() => {
        if (pending.current === requestId) {
          pending.current = null;
          setStatus("failed");
        }
      }, 20_000);
    } catch {
      if (pending.current === requestId) {
        pending.current = null;
        setStatus("failed");
      }
    }
  }

  return (
    <main hidden={!active} className="blotlens-workflow">
      <header>
        <a href={href("#home")}><ArrowLeft size={16} />{t("返回 WB 首页", "Back to WB home")}</a>
        <a href={source} target="_blank" rel="noreferrer">{t("独立打开", "Open separately")}<ExternalLink size={15} /></a>
      </header>
      <div className="blotlens-heading">
        <h1>{t("截图趋势核对", "Screenshot trend review")} <small>BlotLens</small></h1>
        <button className="button primary" disabled={!ready} onClick={() => input.current?.click()}><Upload size={16} />{t("导入核对截图", "Import screenshot")}</button>
      </div>
      <p>{t("在下方单独导出 BlotLens 分析 JSON。手动核对在本机完成；点击 AI 识别会将选定图像发送给配置的服务。", "Export the BlotLens analysis JSON below. Manual review runs locally. Selecting AI recognition sends the chosen image to your configured provider.")}</p>
      {status && <p role="status">{t(messages[status][0], messages[status][1])}</p>}
      <input ref={input} type="file" hidden accept="image/png,image/jpeg" aria-label={t("导入工作台核对截图", "Import image into screenshot review")} onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void sendImage(file);
      }} />
      <iframe ref={frame} src={source} title={t("BlotLens 截图趋势核对", "BlotLens screenshot review")} />
    </main>
  );
}
