import assert from "node:assert/strict";
import { test } from "node:test";
import { allowsLandscape, portraitLockAngle, viewportAngle, type OrientSurface } from "./portrait.ts";

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

test("竖屏不转；横屏只在不允许横屏时按设备角转回", () => {
  assert.equal(portraitLockAngle(true, 90), null);
  assert.equal(portraitLockAngle(false, 0), null);
  assert.equal(portraitLockAngle(false, 180), null);
  assert.equal(portraitLockAngle(false, 90), 90);
  assert.equal(portraitLockAngle(false, 270), 270);
  assert.equal(viewportAngle(undefined, 800, 400), 90);
  assert.equal(viewportAngle(undefined, 400, 800), 0);
  assert.equal(viewportAngle(270, 800, 400), 270);
});
