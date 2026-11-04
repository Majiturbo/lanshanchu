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
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const busy = useRef(false);
  const timer = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  const push = useCallback((page: T) => {
    if (busy.current) return;
    busy.current = true;
    setPhase("push");
    setStack((s) => [...s, page]);
    clearTimeout(timer.current);
    const wait = reduceMotion() ? 1 : NAV_MS;
    timer.current = window.setTimeout(() => {
      busy.current = false;
      setPhase("idle");
    }, wait);
  }, []);

  /** 按钮/系统返回：先播成对推出，动画结束再切栈。
   * 若立刻 slice，front 会复用成一级并被打上 is-pop-reveal，一级页会再往右挪一下。 */
  const pop = useCallback((): boolean => {
    if (busy.current) return stackRef.current.length > 1;
    if (stackRef.current.length <= 1) return false;
    busy.current = true;
    setPhase("pop");
    clearTimeout(timer.current);
    const wait = reduceMotion() ? 1 : NAV_MS;
    timer.current = window.setTimeout(() => {
      setStack((s) => s.slice(0, -1));
      setPhase("idle");
      busy.current = false;
    }, wait);
    return true;
  }, []);

  /** 侧滑已把顶层拖出屏幕：瞬时卸层，不播 is-pop-out，否则会闪回两页 */
  const popSwipe = useCallback((): boolean => {
    if (stackRef.current.length <= 1) return false;
    clearTimeout(timer.current);
    busy.current = false;
    setPhase("idle");
    setStack((s) => s.slice(0, -1));
    return true;
  }, []);

  const replace = useCallback((next: T[]) => {
    clearTimeout(timer.current);
    busy.current = false;
    setPhase("idle");
    setStack(next);
  }, []);

  return { stack, stackRef, phase, push, pop, popSwipe, replace };
}
