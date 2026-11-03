import { useEffect, useRef, useState } from "react";
import { useSettings } from "../settings/store.ts";

// 孔明灯按动画片灯会：透光纸袋。越飞越高、越远越小，飞出画面。
// 颜色是品牌色，不随配色方案变化，所以不走 tokens.css。

const GOLD = "#efc163";
const FLAME = "#fbe3a6";
const PAPER = "#f3d089";
const PAPER_EDGE = "#c48430";

const COUNT = 6;
const PAD = 36;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

const isDark = () => {
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  return matchMedia("(prefers-color-scheme: dark)").matches;
};

/** 浅色不放灯；跟随系统时听系统明暗 */
export function useNight() {
  const theme = useSettings((s) => s.theme);
  const [osDark, setOsDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setOsDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return osDark;
}

type SkyLantern = {
  x: number; y: number; z: number;
  tilt: number; spin: number; phase: number;
};
type Band = { left: number; width: number; floorY: number };

function inset(band: Band): Band {
  return {
    left: band.left + PAD,
    width: Math.max(48, band.width - PAD * 2),
    floorY: band.floorY,
  };
}

function clampX(x: number, band: Band) {
  const b = inset(band);
  return Math.min(b.left + b.width, Math.max(b.left, x));
}

function place(band: Band, y: number, z: number, others: SkyLantern[]): SkyLantern {
  const b = inset(band);
  let x = b.left + b.width / 2, score = -1;
  for (let i = 0; i < COUNT + 4; i++) {
    const cx = b.left + ((i + 0.5) / (COUNT + 4)) * b.width;
    let min = Infinity;
    for (const o of others) min = Math.min(min, Math.hypot(o.x - cx, (o.y - y) * 0.35));
    if (min > score) { score = min; x = cx; }
  }
  return {
    x: x + rand(-8, 8), y, z,
    tilt: rand(-0.05, 0.05),
    spin: rand(-0.04, 0.04),
    phase: rand(0, Math.PI * 2),
  };
}

function seedLanterns(band: Band): SkyLantern[] {
  const b = inset(band);
  const out: SkyLantern[] = [];
  for (let i = 0; i < COUNT; i++) {
    out.push({
      x: b.left + ((i + 0.5) / COUNT) * b.width + rand(-10, 10),
      y: ((i * 0.618) % 1) * 0.82 * b.floorY + 0.1 * b.floorY,
      z: i % 2 === 0 ? rand(0.32, 0.52) : rand(0.62, 1),
      tilt: rand(-0.05, 0.05),
      spin: rand(-0.04, 0.04),
      phase: rand(0, Math.PI * 2),
    });
  }
  return out;
}

function lanternPath(ctx: CanvasRenderingContext2D, wTop: number, wBot: number, top: number, bot: number) {
  ctx.beginPath();
  ctx.moveTo(-wBot, bot);
  ctx.lineTo(-wTop, top + (bot - top) * 0.22);
  ctx.quadraticCurveTo(-wTop * 0.12, top, 0, top);
  ctx.quadraticCurveTo(wTop * 0.12, top, wTop, top + (bot - top) * 0.22);
  ctx.lineTo(wBot, bot);
  ctx.closePath();
}

function drawKongming(ctx: CanvasRenderingContext2D, L: SkyLantern, clock: number, night: number, floorY: number) {
  const rise = Math.max(0, Math.min(1, L.y / Math.max(1, floorY)));
  const recede = 0.4 + 0.6 * rise;
  const gone = L.y < 8 ? Math.min(1, (8 - L.y) / 64) : 0;
  if (recede * (1 - gone) < 0.04) return;
  const s = (8 + L.z * 13) * recede;
  const hh = s * 1.28;
  const a = (0.5 + L.z * 0.5) * (0.7 + night * 0.3) * (1 - gone);
  const sway = Math.sin(clock * 0.26 + L.phase) * (1 + L.z * 2.2) * recede;
  const top = -hh * 0.5;
  const bot = hh * 0.42;
  const wTop = s * 0.46;
  const wBot = s * 0.34;
  ctx.save();
  ctx.translate(L.x + sway, L.y);
  ctx.rotate(L.tilt + Math.sin(clock * 0.22 + L.phase) * 0.025);

  const halo = ctx.createRadialGradient(0, hh * 0.08, 0, 0, hh * 0.08, s * 1.7);
  halo.addColorStop(0, "rgba(255, 244, 200, 0.5)");
  halo.addColorStop(0.4, "rgba(239, 193, 99, 0.18)");
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = a * 0.75 * night;
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.ellipse(0, hh * 0.05, s * 1.55, hh * 1.15, 0, 0, Math.PI * 2);
  ctx.fill();

  lanternPath(ctx, wTop, wBot, top, bot);
  const paper = ctx.createLinearGradient(-wTop, 0, wTop, 0);
  paper.addColorStop(0, PAPER_EDGE);
  paper.addColorStop(0.28, PAPER);
  paper.addColorStop(0.5, "#fff6d2");
  paper.addColorStop(0.72, PAPER);
  paper.addColorStop(1, PAPER_EDGE);
  ctx.globalAlpha = a;
  ctx.fillStyle = paper;
  ctx.fill();

  const belly = ctx.createRadialGradient(0, hh * 0.14, 0, 0, hh * 0.16, s * 0.5);
  belly.addColorStop(0, "rgba(255, 252, 230, 0.92)");
  belly.addColorStop(0.45, "rgba(255, 220, 140, 0.35)");
  belly.addColorStop(1, "rgba(255, 200, 100, 0)");
  ctx.fillStyle = belly;
  ctx.fill();

  ctx.globalAlpha = a * 0.22;
  ctx.strokeStyle = "rgba(180, 110, 30, 0.55)";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(0, top + 2);
  ctx.lineTo(0, bot - 1);
  ctx.stroke();

  ctx.globalAlpha = a * 0.95;
  ctx.fillStyle = GOLD;
  ctx.fillRect(-wBot * 0.78, bot - 1.2, wBot * 1.56, 2.4);

  ctx.globalAlpha = a;
  ctx.fillStyle = FLAME;
  ctx.beginPath();
  ctx.ellipse(0, bot + 2.4, s * 0.07, s * 0.11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * 提问框上方的孔明灯，宽度不超过输入框。灯往天上飞，越远越小。
 * 减少动态效果时只留静止的灯。
 */
export function LanternSky({ active }: { active: boolean }) {
  const back = useRef<HTMLCanvasElement>(null);
  const front = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    const backEl = back.current, frontEl = front.current;
    if (!backEl || !frontEl) return;
    const host = backEl.parentElement;
    if (!host) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const night = () => (isDark() ? 1 : 0.45);
    let w = 0, h = 0, dpr = 1;
    let lanterns: SkyLantern[] = [];
    let clock = 0, last = performance.now(), raf = 0;

    const size = () => {
      dpr = Math.min(2, devicePixelRatio || 1);
      w = host.clientWidth;
      h = host.clientHeight;
      for (const c of [backEl, frontEl]) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
        c.style.width = `${w}px`;
        c.style.height = `${h}px`;
      }
    };

    const band = (): Band => {
      const ask = host.querySelector(".ask");
      const box = backEl.getBoundingClientRect();
      if (!ask) return { left: w * 0.12, width: w * 0.76, floorY: h * 0.55 };
      const a = ask.getBoundingClientRect();
      return {
        left: a.left - box.left,
        width: a.width,
        floorY: Math.max(48, a.top - box.top),
      };
    };

    const clip = (ctx: CanvasRenderingContext2D, b: Band) => {
      ctx.beginPath();
      ctx.rect(b.left, -h, b.width, b.floorY + h);
      ctx.clip();
    };

    const paint = (ctx: CanvasRenderingContext2D, layer: "back" | "front", n: number, b: Band) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      clip(ctx, b);
      for (const L of lanterns) {
        if (layer === "back" ? L.z >= 0.54 : L.z < 0.54) continue;
        drawKongming(ctx, L, clock, n, b.floorY);
      }
      ctx.restore();
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt;
      const n = night();
      const b = band();
      if (lanterns.length === 0 && b.floorY > 40) lanterns = seedLanterns(b);
      if (!still) {
        for (const L of lanterns) {
          L.y -= (8 + L.z * 16) * dt;
          L.x = clampX(L.x + L.spin * 3 * dt, b);
          L.tilt += Math.sin(clock + L.phase) * 0.008 * dt;
          if (L.y < -48) Object.assign(L, place(b, b.floorY, L.z, lanterns));
        }
      }
      const bc = backEl.getContext("2d"), fc = frontEl.getContext("2d");
      if (bc) paint(bc, "back", n, b);
      if (fc) paint(fc, "front", n, b);
      raf = requestAnimationFrame(frame);
    };

    size();
    const ro = new ResizeObserver(size);
    ro.observe(host);
    raf = requestAnimationFrame(frame);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [active]);

  if (!active) return null;
  return (
    <>
      <canvas ref={back} className="lantern-sky is-back" aria-hidden="true" />
      <canvas ref={front} className="lantern-sky is-front" aria-hidden="true" />
    </>
  );
}
