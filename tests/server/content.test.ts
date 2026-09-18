import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadContent, resolveContentRoot } from "../../src/server/content/loadContent.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Writes a throwaway content tree, so a test can assert on content that must not be committed. */
function contentRoot(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "dnd-content-"));
  roots.push(root);

  for (const [path, body] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
  }

  return root;
}

const ASH_IMP = {
  id: "ash-imp",
  name: "Ash Imp",
  maxHealth: 12,
  speed: 1.8,
  aggroRange: 5,
  attackRange: 1,
  damage: 8,
  attackCooldownMs: 1000,
};

describe("the shipped content", () => {
  it("loads and validates", () => {
    const content = loadContent();

    expect(content.monsters.size).toBeGreaterThan(0);
    expect(content.items.size).toBeGreaterThan(0);
    expect(content.templates.size).toBeGreaterThan(0);
    expect(content.dungeons.has("ember-vault")).toBe(true);
    expect(content.dungeons.has("vault-run")).toBe(true);
  });

  it("resolves the repository content directory, not the source folder of the same name", () => {
    // basename rather than a regex, so the assertion reads the same on Windows and POSIX paths.
    expect(basename(resolveContentRoot())).toBe("content");
    expect(resolveContentRoot()).not.toContain(join("src", "server"));
  });

  it("gives every room template at least one way in", () => {
    const content = loadContent();

    for (const template of content.templates.values()) {
      expect(template.doorways.length).toBeGreaterThan(0);
    }
  });
});

describe("rejecting bad content", () => {
  it("names the file when JSON will not parse", () => {
    const root = contentRoot({ "monsters/broken.json": "{ not json" });

    expect(() => loadContent(root)).toThrow(/broken\.json is not valid JSON/);
  });

  it("names the file and the field when a value is wrong", () => {
    const root = contentRoot({ "monsters/ash-imp.json": { ...ASH_IMP, maxHealth: -3 } });

    expect(() => loadContent(root)).toThrow(/ash-imp\.json is not valid content.*maxHealth/s);
  });

  it("refuses two files claiming the same id", () => {
    const root = contentRoot({
      "monsters/a.json": ASH_IMP,
      "monsters/b.json": ASH_IMP,
    });

    expect(() => loadContent(root)).toThrow(/reuses the content id "ash-imp"/);
  });

  it("refuses a template spawning a monster that does not exist", () => {
    const root = contentRoot({
      "dungeons/templates/hall.json": {
        id: "hall",
        name: "Hall",
        kind: "hall",
        tiles: ["###", "#.#", "###"],
        doorways: [{ x: 0, y: 1, side: "west" }],
        monsters: [{ typeId: "no-such-monster", min: 1, max: 1 }],
      },
    });

    expect(() => loadContent(root)).toThrow(/unknown monster type "no-such-monster"/);
  });

  it("refuses a ragged map, which collision would read past the end of", () => {
    const root = contentRoot({
      "dungeons/ragged.json": {
        id: "ragged",
        name: "Ragged",
        layout: "authored",
        tiles: ["#####", "#..#", "#####"],
        spawnPoints: [{ x: 1, y: 1 }],
      },
    });

    expect(() => loadContent(root)).toThrow(/rows of differing lengths/);
  });

  it("refuses a template whose doorways do not connect through its own floor", () => {
    const root = contentRoot({
      "dungeons/templates/split.json": {
        id: "split",
        name: "Split",
        kind: "maze",
        // Two chambers with no way between them: a party walks in one side and finds no way through.
        tiles: ["#####", "#.#.#", "#.#.#", "#####"],
        doorways: [
          { x: 0, y: 1, side: "west" },
          { x: 4, y: 2, side: "east" },
        ],
      },
    });

    expect(() => loadContent(root)).toThrow(/do not connect through its own floor/);
  });

  it("refuses a generated profile asking for a room kind no template provides", () => {
    const root = contentRoot({
      "dungeons/templates/gate.json": {
        id: "gate",
        name: "Gate",
        kind: "entrance",
        tiles: ["###", "#.#", "###"],
        doorways: [{ x: 0, y: 1, side: "west" }],
      },
      "dungeons/run.json": {
        id: "run",
        name: "Run",
        layout: "generated",
        width: 40,
        height: 40,
        slots: [{ kinds: ["boss"], min: 1, max: 1 }],
        exitDestination: "hub",
      },
    });

    expect(() => loadContent(root)).toThrow(/needs a template of kind boss/);
  });
});
