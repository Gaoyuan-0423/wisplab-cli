import React, { Suspense, lazy, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { useLanguage } from "./i18n";
import App from "./App";
import Home from "./Home";
import BlotLensPanel from "./BlotLensPanel";
import "./styles.css";
import "./theme.css";

const RealWorkbench = lazy(() => import("./real/RealWorkbench"));

const SingleStripApp = lazy(() => import("./single/SingleStripApp"));
const QuickApp = lazy(() => import("./quick/QuickApp"));

type Route = "home" | "real" | "demo" | "single" | "quick" | "blotlens";

function routeFor(hash: string): Route {
  const mode = new URLSearchParams(window.location.search).get("mode");
  if (hash === "#home") return "home";
  if (hash === "#blotlens") return "blotlens";
  if (mode === "single" || mode === "quick") return mode;
  if (hash.startsWith("#real")) return "real";
  if (hash.startsWith("#demo") || hash.startsWith("#guide")) return "demo";
  return mode === "project" ? "demo" : "home";
}

function WorkspaceRouter() {
  const [route, setRoute] = useState<Route>(() =>
    routeFor(window.location.hash),
  );
  const [openedReview, setOpenedReview] = useState(route === "blotlens");
  useEffect(() => {
    const update = () => {
      const next = routeFor(window.location.hash);
      setRoute(next);
      if (next === "blotlens") setOpenedReview(true);
    };
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, []);

  useEffect(() => {
    // The simple workspaces use query-string links. Keep the review frame mounted
    // when following those links, including Back/Forward, just like hash navigation.
    if (!openedReview || route === "demo" || route === "real") return;
    function followModeLink(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target || link.hasAttribute("download")) return;
      const next = new URL(link.href);
      if (next.origin !== location.origin || next.pathname !== location.pathname || next.search === location.search) return;
      if (next.searchParams.get("mode") === new URLSearchParams(location.search).get("mode")) return;
      event.preventDefault();
      window.history.pushState(null, "", next);
      setRoute(routeFor(next.hash));
    }
    document.addEventListener("click", followModeLink);
    return () => document.removeEventListener("click", followModeLink);
  }, [openedReview, route]);

  return (
    <>
      {openedReview && <BlotLensPanel active={route === "blotlens"} />}
      {route !== "blotlens" && <WorkbenchPage route={route} />}
    </>
  );
}

function WorkbenchPage({ route }: { route: Exclude<Route, "blotlens"> }) {
  const { t } = useLanguage();
  if (route === "single" || route === "quick")
    return (
      <Suspense
        fallback={
          <div className="workspace-loading" role="status">
            {t("正在打开条带工作区…", "Opening strip workspace…")}
          </div>
        }
      >
        {route === "single" ? <SingleStripApp /> : <QuickApp />}
      </Suspense>
    );

  if (route === "real")
    return (
      <Suspense
        fallback={
          <div role="status">
            {t("正在打开真实图像工作区…", "Opening image workspace…")}
          </div>
        }
      >
        <RealWorkbench
          onDemo={() => {
            window.location.hash = "demo";
          }}
        />
      </Suspense>
    );
  if (route === "demo") return <App />;
  return <Home />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WorkspaceRouter />
  </React.StrictMode>,
);
