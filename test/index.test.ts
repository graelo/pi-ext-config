import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  it("uses only the global path when includeProject is false", () => {
    expect(
      getConfigPaths(EXTENSION_ID, { cwd: repo, agentDir, includeProject: false }),
    ).toEqual([resolve(agentDir, "extensions", EXTENSION_ID, CONFIG_FILENAME)]);
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

  it("ignores a project file when includeProject is false", () => {
    const global = writeGlobalConfig("{}");
    writeProjectConfig(repo, "{}");
    expect(
      resolveConfigPath(EXTENSION_ID, { cwd: repo, agentDir, includeProject: false }),
    ).toBe(global);
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

  it("uses only global config when includeProject is false", () => {
    const global = writeGlobalConfig(JSON.stringify({ url: "http://global" }));
    writeProjectConfig(repo, JSON.stringify({ url: "http://project" }));

    const loaded = loadConfig(EXTENSION_ID, DEFAULTS, {
      cwd: repo,
      agentDir,
      includeProject: false,
    });
    expect(loaded.config).toEqual({ url: "http://global", timeoutMs: 30000 });
    expect(loaded.sources).toEqual([global]);
    expect(loaded.candidates).toEqual([global]);
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

  it("blames the read, not the JSON, when the path is a directory", () => {
    // EISDIR: the file is unopenable, not malformed. Saying "not valid JSON" would
    // send the user off editing something that does not exist.
    mkdirSync(join(repo, ".pi", "extensions", EXTENSION_ID, CONFIG_FILENAME), {
      recursive: true,
    });
    writeGlobalConfig(JSON.stringify({ url: "http://global" }));

    const loaded = loadConfig(EXTENSION_ID, DEFAULTS, { cwd: repo, agentDir });
    expect(loaded.config.url).toBe("http://global");
    expect(loaded.diagnostics).toHaveLength(1);
    expect(loaded.diagnostics[0]).toContain("could not be read");
    expect(loaded.diagnostics[0]).not.toContain("not valid JSON");
  });

  it.skipIf(process.getuid?.() === 0)(
    "blames the read, not the JSON, when the file is unreadable",
    () => {
      const project = writeProjectConfig(repo, JSON.stringify({ url: "http://project" }));
      chmodSync(project, 0o000);
      writeGlobalConfig(JSON.stringify({ url: "http://global" }));

      const loaded = loadConfig(EXTENSION_ID, DEFAULTS, { cwd: repo, agentDir });
      // Perfectly valid JSON that pi simply cannot open.
      expect(loaded.config.url).toBe("http://global");
      expect(loaded.diagnostics[0]).toContain("could not be read");
      expect(loaded.diagnostics[0]).not.toContain("not valid JSON");
    },
  );

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

describe('loadConfig with strategy: "shallow-merge"', () => {
  const merge = { strategy: "shallow-merge" } as const;

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
    // Shallow: the global endpoint does not survive under a nested key.
    expect(loaded.config.phoenix).toEqual({ project: "mine" });
  });
});

describe('loadConfig with strategy: "deep-merge"', () => {
  const deep = { strategy: "deep-merge" } as const;

  it("layers the project file over the global one", () => {
    const global = writeGlobalConfig(
      JSON.stringify({ url: "http://global", timeoutMs: 1000 }),
    );
    const project = writeProjectConfig(repo, JSON.stringify({ url: "http://project" }));

    const loaded = loadConfig(EXTENSION_ID, DEFAULTS, { cwd: repo, agentDir, ...deep });
    expect(loaded.config).toEqual({ url: "http://project", timeoutMs: 1000 });
    expect(loaded.sources).toEqual([global, project]);
  });

  it("merges nested objects recursively", () => {
    interface Nested {
      phoenix: { endpoint?: string; project?: string };
    }
    const defaults: Nested = { phoenix: {} };
    writeGlobalConfig(JSON.stringify({ phoenix: { endpoint: "http://global" } }));
    writeProjectConfig(repo, JSON.stringify({ phoenix: { project: "mine" } }));

    const loaded = loadConfig<Nested>(EXTENSION_ID, defaults, {
      cwd: repo,
      agentDir,
      ...deep,
    });
    // Deep merge: both keys survive because each file only overrides its own.
    expect(loaded.config.phoenix).toEqual({
      endpoint: "http://global",
      project: "mine",
    });
  });

  it("replaces arrays wholesale (no element-wise concatenation)", () => {
    interface ArrayConfig {
      tags: string[];
    }
    const defaults: ArrayConfig = { tags: [] };
    writeGlobalConfig(JSON.stringify({ tags: ["a", "b"] }));
    writeProjectConfig(repo, JSON.stringify({ tags: ["c"] }));

    const loaded = loadConfig<ArrayConfig>(EXTENSION_ID, defaults, {
      cwd: repo,
      agentDir,
      ...deep,
    });
    expect(loaded.config.tags).toEqual(["c"]);
  });

  it("lets an explicit null clear a nested object", () => {
    interface Nullable {
      phoenix: { endpoint: string } | null;
    }
    const defaults: Nullable = { phoenix: { endpoint: "http://default" } };
    writeGlobalConfig(JSON.stringify({ phoenix: { endpoint: "http://global" } }));
    writeProjectConfig(repo, JSON.stringify({ phoenix: null }));

    const loaded = loadConfig<Nullable>(EXTENSION_ID, defaults, {
      cwd: repo,
      agentDir,
      ...deep,
    });
    // Only plain objects are merged; null replaces, so a repo can opt out entirely.
    expect(loaded.config.phoenix).toBeNull();
  });

  it("merges three layers (defaults → global → project)", () => {
    interface Multi {
      a: { x: number; y: number };
      b: number;
    }
    const defaults: Multi = { a: { x: 1, y: 2 }, b: 10 };
    writeGlobalConfig(JSON.stringify({ a: { x: 10 }, b: 20 }));
    writeProjectConfig(repo, JSON.stringify({ a: { y: 99 } }));

    const loaded = loadConfig<Multi>(EXTENSION_ID, defaults, {
      cwd: repo,
      agentDir,
      ...deep,
    });
    expect(loaded.config).toEqual({ a: { x: 10, y: 99 }, b: 20 });
  });

  it("behaves like first-match when only one file exists", () => {
    writeProjectConfig(repo, JSON.stringify({ url: "http://project" }));

    const merged = loadConfig(EXTENSION_ID, DEFAULTS, { cwd: repo, agentDir, ...deep });
    const first = loadConfig(EXTENSION_ID, DEFAULTS, { cwd: repo, agentDir });
    expect(merged).toEqual(first);
  });

  it("still skips a malformed file and keeps the usable one", () => {
    const global = writeGlobalConfig(JSON.stringify({ url: "http://global" }));
    writeProjectConfig(repo, "not json {{{");

    const loaded = loadConfig(EXTENSION_ID, DEFAULTS, { cwd: repo, agentDir, ...deep });
    expect(loaded.config.url).toBe("http://global");
    expect(loaded.sources).toEqual([global]);
    expect(loaded.diagnostics).toHaveLength(1);
  });

  it("does not share state between calls", () => {
    writeGlobalConfig(JSON.stringify({ timeoutMs: 1 }));
    const first = loadConfig(EXTENSION_ID, DEFAULTS, { cwd: repo, agentDir, ...deep });
    first.config.timeoutMs = 999;

    const second = loadConfig(EXTENSION_ID, DEFAULTS, { cwd: repo, agentDir, ...deep });
    expect(second.config.timeoutMs).toBe(1);
    expect(DEFAULTS.timeoutMs).toBe(30000);
  });
});

describe("loadConfig isolation from defaults", () => {
  interface Nested {
    phoenix: { endpoint: string; project?: string };
    timeoutMs: number;
  }

  const strategies = ["first-match", "shallow-merge", "deep-merge"] as const;

  function nestedDefaults(): Nested {
    return { phoenix: { endpoint: "http://default" }, timeoutMs: 30000 };
  }

  it.each(strategies)(
    "does not hand back a nested default by reference under %s",
    (strategy) => {
      const defaults = nestedDefaults();
      // Touches only a top-level key, so `phoenix` comes straight from the defaults —
      // the case a shallow copy of the seed would alias.
      writeGlobalConfig(JSON.stringify({ timeoutMs: 1 }));

      const loaded = loadConfig<Nested>(EXTENSION_ID, defaults, {
        cwd: repo,
        agentDir,
        strategy,
      });
      loaded.config.phoenix.endpoint = "MUTATED";

      expect(defaults.phoenix.endpoint).toBe("http://default");
    },
  );

  it.each(strategies)(
    "keeps a later call pristine after a caller mutates a nested value under %s",
    (strategy) => {
      // The harm the isolation exists to prevent: extensions keep DEFAULTS as a
      // module-level constant, so one mutation would outlive the call that made it.
      const defaults = nestedDefaults();
      writeGlobalConfig(JSON.stringify({ timeoutMs: 1 }));
      const options = { cwd: repo, agentDir, strategy } as const;

      loadConfig<Nested>(EXTENSION_ID, defaults, options).config.phoenix.endpoint =
        "MUTATED";

      const second = loadConfig<Nested>(EXTENSION_ID, defaults, options);
      expect(second.config.phoenix.endpoint).toBe("http://default");
    },
  );

  it("clones structurally rather than through JSON, so a Date survives", () => {
    interface WithDate {
      since: Date;
    }
    const defaults: WithDate = { since: new Date("2020-01-01T00:00:00Z") };
    writeGlobalConfig(JSON.stringify({}));

    const loaded = loadConfig<WithDate>(EXTENSION_ID, defaults, {
      cwd: repo,
      agentDir,
      strategy: "deep-merge",
    });
    expect(loaded.config.since).toBeInstanceOf(Date);
    expect(loaded.config.since.getTime()).toBe(defaults.since.getTime());
    expect(loaded.config.since).not.toBe(defaults.since);
  });
});
