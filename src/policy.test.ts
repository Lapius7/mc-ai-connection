import { describe, expect, test } from "bun:test";
import { DEFAULT_DENY, check, denied } from "./policy.ts";

const p = { allow: [], deny: DEFAULT_DENY };

describe("policy", () => {
  test("既定で stop / op / ban を拒否し、通常のコマンドは通す", () => {
    for (const c of ["stop", "/op Steve", "ban Steve", "ban-ip 1.2.3.4", "pardon x", "deop x"]) expect(check(p, c)).not.toBeNull();
    for (const c of ["fill 0 0 0 1 1 1 stone", "time set day", "say stop", "list"]) expect(check(p, c)).toBeNull();
  });
  test("大文字小文字・名前空間・先頭スラッシュで回避できない", () => {
    expect(check(p, "STOP")).not.toBeNull();
    expect(check(p, "/minecraft:op Steve")).not.toBeNull();
    expect(check(p, "  Stop ")).not.toBeNull();
  });
  test("execute の run 以降も検査する", () => {
    expect(check(p, "execute as @a run op @s")).not.toBeNull();
    expect(check(p, "execute if entity @a run execute at @s run stop")).not.toBeNull();
    expect(check(p, "execute as @a run say hi")).toBeNull();
    expect(check(p, "say please run stop")).toBeNull();
  });
  test("許可リストがあると、前方一致するものだけ通す", () => {
    const a = { allow: ["fill", "time set", "execute"], deny: DEFAULT_DENY };
    expect(check(a, "fill 0 0 0 1 1 1 stone")).toBeNull();
    expect(check(a, "time set day")).toBeNull();
    expect(check(a, "time query day")).not.toBeNull();
    expect(check(a, "give @a diamond")).not.toBeNull();
    expect(check(a, "execute as @a run give @s stone")).not.toBeNull();
  });
  test("禁止は許可より優先し、deny を空にすれば無効になる", () => {
    expect(check({ allow: ["op"], deny: ["op"] }, "op x")).not.toBeNull();
    expect(check({ allow: [], deny: [] }, "stop")).toBeNull();
  });
  test("denied は理由つきで返し、重複を畳む", () => {
    const d = denied(p, ["op a", "op b", "fill 0 0 0 0 0 0 stone", "stop"]);
    expect(d.length).toBe(2);
  });
});
