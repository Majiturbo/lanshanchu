import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { trackAppOpened } from "./analytics/index.ts";
import { HistoryPanel } from "./components/History.tsx";
import { Home } from "./components/Home.tsx";
import { SettingsDialog } from "./components/SettingsDialog.tsx";
import { LeaveDialog } from "./components/LeaveDialog.tsx";
import { useWindowFocus } from "./components/TitleBar.tsx";
import { Toast } from "./components/Toast.tsx";
import { Tooltip } from "./components/Tooltip.tsx";
import { Workspace } from "./components/Workspace.tsx";
import "./core/device.ts";
import { IN_APP } from "./core/http.ts";
import { refreshAccount } from "./core/platform.ts";
import { startAutosave } from "./history/store.ts";
import { startMemory } from "./memory/run.ts";
import { useGraph } from "./store/graph.ts";
import { useSettings, type Theme } from "./settings/store.ts";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/panels.css";

// 桌面应用里屏蔽 WebView 自带的右键菜单（返回、刷新、另存为……），输入框保留复制粘贴菜单
if (IN_APP && !import.meta.env.DEV) {
  addEventListener("contextmenu", (e) => {
    if (!(e.target as HTMLElement).closest("input, textarea")) e.preventDefault();
  });
}

startAutosave();
startMemory(() => useGraph.getState().map?.id ?? null);
trackAppOpened();
useSettings.persist.onFinishHydration(() => { void refreshAccount(); });
if (useSettings.persist.hasHydrated()) void refreshAccount();

function App() {
  const screen = useGraph((s) => s.screen);
  useWindowFocus();
  return (
    <>
      {screen === "home" ? <Home /> : <Workspace />}
      <HistoryPanel />
      <SettingsDialog />
      <LeaveDialog />
      <Toast />
      <Tooltip />
    </>
  );
}

// 明暗写到 html 的 data-theme（跟随系统时不写，由 prefers-color-scheme 决定）；首次渲染前就设好
delete document.documentElement.dataset.palette;
const isDarkTheme = (t: Theme) => t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
const applyFavicon = (dark: boolean) => {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  link.href = dark ? "/favicon.png?v=lantern-night" : "/favicon-light.png?v=lantern-day";
};
const applyTheme = (t: Theme) => {
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  applyFavicon(isDarkTheme(t));
};
applyTheme(useSettings.getState().theme);
useSettings.subscribe((s) => { applyTheme(s.theme); });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (useSettings.getState().theme === "system") applyTheme("system");
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
