import { useCallback, useEffect, useRef, useState } from "react";
import { IS_MOBILE_APP } from "../core/device.ts";

/** 全屏栈导航时长：比面板略长，行程才读得清，收尾用 --ease-nav */
export const NAV_MS = 320;

const reduceMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 全屏盖住首页/画布时，底层跟着轻移一点（视差），关掉时一起回位 */
export function useNavCover(active: boolean, closing: boolean) {
  useEffect(() => {
    if (!IS_MOBILE_APP) return;
    const root = document.documentElement;
    if (!active || closing || reduceMotion()) {
      delete root.dataset.navCover;
      return;
    }
    const id = requestAnimationFrame(() => {
      root.dataset.navCover = "";
    });
    return () => {
      cancelAnimationFrame(id);
      delete root.dataset.navCover;
    };
  }, [active, closing]);
}

export type StackPhase = "idle" | "push" | "pop";

/** 设置等多级全屏：保留下层页做视差，推入/推出成对播放 */
export function useStackNav<T extends string>(initial: T[]) {
  const [stack, setStack] = useState<T[]>(initial);
  const [phase, setPhase] = useState<StackPhase>("idle");
  const [outgoing, setOutgoing] = useState<T | null>(null);
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const busy = useRef(false);
  const timer = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  const finish = useCallback(() => {
    clearTimeout(timer.current);
    const wait = reduceMotion() ? 1 : NAV_MS;
    timer.current = window.setTimeout(() => {
      busy.current = false;
      setPhase("idle");
      setOutgoing(null);
    }, wait);
  }, []);

  const push = useCallback((page: T) => {
    if (busy.current) return;
    busy.current = true;
    setOutgoing(null);
    setPhase("push");
    setStack((s) => [...s, page]);
    finish();
  }, [finish]);

  const pop = useCallback((): boolean => {
    if (busy.current) return stackRef.current.length > 1;
    if (stackRef.current.length <= 1) return false;
    busy.current = true;
    const top = stackRef.current[stackRef.current.length - 1]!;
    setOutgoing(top);
    setPhase("pop");
    setStack((s) => s.slice(0, -1));
    finish();
    return true;
  }, [finish]);

  const replace = useCallback((next: T[]) => {
    clearTimeout(timer.current);
    busy.current = false;
    setOutgoing(null);
    setPhase("idle");
    setStack(next);
  }, []);

  return { stack, stackRef, phase, outgoing, push, pop, replace };
}
