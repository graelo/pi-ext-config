import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CONFIG_FILENAME,
  findGitRoot,
  getConfigPaths,
  loadConfig,
  resolveConfigPath,
} from "../src/index.js";

const EXTENSION_ID = "pi-example";

interface ExampleConfig {
  url: string;
  timeoutMs: number;
}

const DEFAULTS: ExampleConfig = { url: "http://localhost", timeoutMs: 30000 };

let sandbox: string;
let repo: string;
let agentDir: string;

/** A repository whose `.git` is a directory, as in a normal clone. */
function makeClone(path: string): string {
  mkdirSync(join(path, ".git"), { recursive: true });
  return path;
}

/** A repository whose `.git` is a *file*, as in a worktree or submodule checkout. */
function makeWorktree(path: string): string {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, ".git"), "gitdir: /elsewhere/.git/worktrees/wt\n");
  return path;
}

function writeProjectConfig(root: string, contents: string): string {
  const dir = join(root, ".pi", "extensions", EXTENSION_ID);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, CONFIG_FILENAME);
  writeFileSync(path, contents);
  return path;
}

function writeGlobalConfig(contents: string): string {
  const dir = join(agentDir, "extensions", EXTENSION_ID);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, CONFIG_FILENAME);
  writeFileSync(path, contents);
  return path;
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "pi-ext-config-"));
  repo = makeClone(join(sandbox, "repo"));
  agentDir = join(sandbox, "agent");
  mkdirSync(agentDir, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("findGitRoot", () => {
  it("finds a repository root whose .git is a directory", () => {
    expect(findGitRoot(repo)).toBe(resolve(repo));
  });

  it("finds a repository root whose .git is a file (worktree or submodule)", () => {
    const worktree = makeWorktree(join(sandbox, "worktree"));
    expect(findGitRoot(worktree)).toBe(resolve(worktree));
  });

  it("walks up from a nested subdirectory", () => {
    const nested = join(repo, "packages", "app", "src");
    mkdirSync(nested, { recursive: true });
    expect(findGitRoot(nested)).toBe(resolve(repo));
  });

  it("returns null outside a repository", () => {
    const orphan = join(sandbox, "orphan");
    mkdirSync(orphan, { recursive: true });
    expect(findGitRoot(orphan)).toBeNull();
  });

  it("stops at the nearest repository, not an outer one", () => {
    const inner = makeClone(join(repo, "vendor", "inner"));
    expect(findGitRoot(inner)).toBe(resolve(inner));
  });
});

describe("getConfigPaths", () => {
  it("lists the project path before the global one", () => {
    expect(getConfigPaths(EXTENSION_ID, { cwd: repo, agentDir })).toEqual([
      resolve(repo, ".pi", "extensions", EXTENSION_ID, CONFIG_FILENAME),
      resolve(agentDir, "extensions", EXTENSION_ID, CONFIG_FILENAME),
    ]);
  });

  it("omits the project path outside a repository", () => {
    const orphan = join(sandbox, "orphan");
    mkdirSync(orphan, { recursive: true });
    expect(getConfigPaths(EXTENSION_ID, { cwd: orphan, agentDir })).toEqual([
      resolve(agentDir, "extensions", EXTENSION_ID, CONFIG_FILENAME),
    ]);
  });

  it("honours PI_CODING_AGENT_DIR when no agentDir is given", () => {
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    try {
      expect(getConfigPaths(EXTENSION_ID, { cwd: repo })).toEqual([
        resolve(repo, ".pi", "extensions", EXTENSION_ID, CONFIG_FILENAME),
        resolve(agentDir, "extensions", EXTENSION_ID, CONFIG_FILENAME),
      ]);
    } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
    }
  });
});

describe("resolveConfigPath", () => {
  it("returns null when nothing exists", () => {
    expect(resolveConfigPath(EXTENSION_ID, { cwd: repo, agentDir })).toBeNull();
  });

  it("prefers the project file", () => {
    writeGlobalConfig("{}");
    const project = writeProjectConfig(repo, "{}");
    expect(resolveConfigPath(EXTENSION_ID, { cwd: repo, agentDir })).toBe(project);
  });

  it("falls back to the global file", () => {
    const global = writeGlobalConfig("{}");
    expect(resolveConfigPath(EXTENSION_ID, { cwd: repo, agentDir })).toBe(global);
  });
});

describe("loadConfig", () => {
  it("returns the defaults when no config exists", () => {
    const loaded = loadConfig(EXTENSION_ID, DEFAULTS, { cwd: repo, agentDir });
    expect(loaded.config).toEqual(DEFAULTS);
    expect(loaded.sources).toEqual([]);
    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.candidates).toHaveLength(2);
  });

  it("applies the winning file over the defaults", () => {
    const global = writeGlobalConfig(JSON.stringify({ timeoutMs: 1000 }));
    const loaded = loadConfig(EXTENSION_ID, DEFAULTS, { cwd: repo, agentDir });
    expect(loaded.config).toEqual({ url: "http://localhost", timeoutMs: 1000 });
    expect(loaded.sources).toEqual([global]);
  });

  it("reads the project file instead of the global one", () => {
    writeGlobalConfig(JSON.stringify({ url: "http://global", timeoutMs: 1000 }));
    const project = writeProjectConfig(repo, JSON.stringify({ url: "http://project" }));

    const loaded = loadConfig(EXTENSION_ID, DEFAULTS, { cwd: repo, agentDir });
    expect(loaded.sources).toEqual([project]);
    // First match wins: the global timeoutMs is not layered in, the default is used.
    expect(loaded.config).toEqual({ url: "http://project", timeoutMs: 30000 });
  });

  it("finds the project file from a nested working directory", () => {
    const nested = join(repo, "packages", "app");
    mkdirSync(nested, { recursive: true });
    writeProjectConfig(repo, JSON.stringify({ url: "http://project" }));

    const loaded = loadConfig(EXTENSION_ID, DEFAULTS, { cwd: nested, agentDir });
    expect(loaded.config.url).toBe("http://project");
  });

  it("skips a malformed project file and falls through to the global one", () => {
    writeGlobalConfig(JSON.stringify({ url: "http://global" }));
    writeProjectConfig(repo, "not json {{{");

    const loaded = loadConfig(EXTENSION_ID, DEFAULTS, { cwd: repo, agentDir });
    expect(loaded.config.url).toBe("http://global");
    expect(loaded.diagnostics).toHaveLength(1);
    expect(loaded.diagnostics[0]).toContain("not valid JSON");
  });

  it("skips a config that is not a JSON object", () => {
    writeProjectConfig(repo, JSON.stringify(["nope"]));

    const loaded = loadConfig(EXTENSION_ID, DEFAULTS, { cwd: repo, agentDir });
    expect(loaded.config).toEqual(DEFAULTS);
    expect(loaded.diagnostics[0]).toContain("must hold a JSON object");
  });

  it("reports every unusable file when none can be read", () => {
    writeProjectConfig(repo, "nope");
    writeGlobalConfig("also nope");

    const loaded = loadConfig(EXTENSION_ID, DEFAULTS, { cwd: repo, agentDir });
    expect(loaded.config).toEqual(DEFAULTS);
    expect(loaded.sources).toEqual([]);
    expect(loaded.diagnostics).toHaveLength(2);
  });

  it("is explicitly first-match by default", () => {
    writeGlobalConfig(JSON.stringify({ timeoutMs: 1000 }));
    writeProjectConfig(repo, JSON.stringify({ url: "http://project" }));

    const implicit = loadConfig(EXTENSION_ID, DEFAULTS, { cwd: repo, agentDir });
    const explicit = loadConfig(EXTENSION_ID, DEFAULTS, {
      cwd: repo,
      agentDir,
      strategy: "first-match",
    });
    expect(implicit).toEqual(explicit);
  });

  it("does not share state between calls", () => {
    writeGlobalConfig(JSON.stringify({ timeoutMs: 1 }));
    const first = loadConfig(EXTENSION_ID, DEFAULTS, { cwd: repo, agentDir });
    first.config.timeoutMs = 999;

    const second = loadConfig(EXTENSION_ID, DEFAULTS, { cwd: repo, agentDir });
    expect(second.config.timeoutMs).toBe(1);
    expect(DEFAULTS.timeoutMs).toBe(30000);
  });
});

describe('loadConfig with strategy: "merge"', () => {
  const merge = { strategy: "merge" } as const;

  it("layers the project file over the global one", () => {
    const global = writeGlobalConfig(
      JSON.stringify({ url: "http://global", timeoutMs: 1000 }),
    );
    const project = writeProjectConfig(repo, JSON.stringify({ url: "http://project" }));

    const loaded = loadConfig(EXTENSION_ID, DEFAULTS, { cwd: repo, agentDir, ...merge });
    // The project url wins; the global timeoutMs survives instead of falling back.
    expect(loaded.config).toEqual({ url: "http://project", timeoutMs: 1000 });
    // Lowest priority first, so the last source is the one that had the final say.
    expect(loaded.sources).toEqual([global, project]);
  });

  it("behaves like first-match when only one file exists", () => {
    writeProjectConfig(repo, JSON.stringify({ url: "http://project" }));

    const merged = loadConfig(EXTENSION_ID, DEFAULTS, { cwd: repo, agentDir, ...merge });
    const first = loadConfig(EXTENSION_ID, DEFAULTS, { cwd: repo, agentDir });
    expect(merged).toEqual(first);
  });

  it("still skips a malformed file and keeps the usable one", () => {
    const global = writeGlobalConfig(JSON.stringify({ url: "http://global" }));
    writeProjectConfig(repo, "not json {{{");

    const loaded = loadConfig(EXTENSION_ID, DEFAULTS, { cwd: repo, agentDir, ...merge });
    expect(loaded.config.url).toBe("http://global");
    expect(loaded.sources).toEqual([global]);
    expect(loaded.diagnostics).toHaveLength(1);
  });

  it("replaces nested objects wholesale rather than deep-merging them", () => {
    interface Nested {
      phoenix: { endpoint?: string; project?: string };
    }
    const defaults: Nested = { phoenix: {} };
    writeGlobalConfig(JSON.stringify({ phoenix: { endpoint: "http://global" } }));
    writeProjectConfig(repo, JSON.stringify({ phoenix: { project: "mine" } }));

    const loaded = loadConfig<Nested>(EXTENSION_ID, defaults, {
      cwd: repo,
      agentDir,
      ...merge,
    });
    // Merging is shallow: the global endpoint does not survive under a nested key.
    expect(loaded.config.phoenix).toEqual({ project: "mine" });
  });
});
