import assert from "node:assert/strict";
import { test } from "node:test";
import { allowsLandscape, orientationMode, type OrientSurface } from "./portrait.ts";

const canvas = (): OrientSurface => ({
  mobile: true,
  screen: "workspace",
  drawer: false,
  reading: false,
  summary: false,
  leaving: false,
  settings: false,
  gate: false,
  phoneBind: false,
  history: false,
  cite: false,
  overlay: false,
});

test("只有光着的知识地图可以横屏", () => {
  assert.equal(allowsLandscape(canvas()), true);
  assert.equal(allowsLandscape({ ...canvas(), screen: "home" }), false);
  assert.equal(allowsLandscape({ ...canvas(), mobile: false, screen: "home" }), true);
});

test("详情、阅读、角标和菜单把横屏收回竖屏", () => {
  for (const patch of [
    { drawer: true },
    { reading: true },
    { cite: true },
    { overlay: true },
    { settings: true },
    { gate: true },
    { summary: true },
    { history: true },
    { phoneBind: true },
    { leaving: true },
  ] as const) {
    assert.equal(allowsLandscape({ ...canvas(), ...patch }), false, JSON.stringify(patch));
  }
});

test("方向锁优先；没锁时画布跟随，其它界面只要正向竖屏", () => {
  assert.equal(orientationMode(true, true), "locked");
  assert.equal(orientationMode(true, false), "locked");
  assert.equal(orientationMode(false, true), "free");
  assert.equal(orientationMode(false, false), "portrait");
});
