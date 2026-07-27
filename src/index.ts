/**
 * Shared config-file resolution for pi extensions.
 *
 * Every extension looks for `config.json` in the same two places, in this order:
 *
 *  1. Project: `<repo-root>/.pi/extensions/<extension-id>/config.json`
 *  2. Global:  `<agent-dir>/extensions/<extension-id>/config.json`
 *
 * What happens when both exist is the extension author's call, via `strategy`:
 * `"first-match"` reads only the project file, `"merge"` layers it over the global
 * one field by field. Defaults always sit underneath whatever is read.
 */

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Directory holding per-extension config inside a repository. */
const PROJECT_CONFIG_DIR = ".pi";

export const CONFIG_FILENAME = "config.json";

/**
 * Find the root of the git repository containing `startPath`.
 *
 * `.git` is a directory in a normal clone but a *file* in worktrees and submodules,
 * so mere existence is what marks the root — never check `isDirectory()` here.
 *
 * @returns the repository root, or `null` when `startPath` is not inside a repository.
 */
export function findGitRoot(startPath: string): string | null {
  let current = resolve(startPath);
  const root = resolve("/");

  while (current !== root) {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export interface ConfigLocationOptions {
  /** Where to start looking for the repository root. Defaults to `process.cwd()`. */
  cwd?: string;
  /**
   * Overrides the agent directory. Defaults to pi's own `getAgentDir()`, which already
   * honours `PI_CODING_AGENT_DIR` and expands a leading `~`. Intended for tests.
   */
  agentDir?: string;
}

/**
 * Candidate config paths in priority order, whether or not they exist.
 *
 * The project path is omitted entirely when `cwd` is not inside a git repository —
 * a bare `./.pi/extensions/...` relative to wherever the agent happens to have been
 * started is not something anyone means to configure.
 */
export function getConfigPaths(
  extensionId: string,
  options: ConfigLocationOptions = {},
): string[] {
  const paths: string[] = [];

  const gitRoot = findGitRoot(options.cwd ?? process.cwd());
  if (gitRoot) {
    paths.push(
      resolve(gitRoot, PROJECT_CONFIG_DIR, "extensions", extensionId, CONFIG_FILENAME),
    );
  }

  const agentDir = options.agentDir ?? getAgentDir();
  paths.push(resolve(agentDir, "extensions", extensionId, CONFIG_FILENAME));

  return paths;
}

/**
 * The config file that would be read, or `null` when none of the candidates exist.
 *
 * This only checks for existence; a file that exists but holds malformed JSON is still
 * returned. Use {@link loadConfig} to actually read one.
 */
export function resolveConfigPath(
  extensionId: string,
  options: ConfigLocationOptions = {},
): string | null {
  return getConfigPaths(extensionId, options).find((path) => existsSync(path)) ?? null;
}

/**
 * How to combine config files when more than one exists.
 *
 * - `"first-match"` (the default) reads only the highest-priority file. A project
 *   config replaces the global one, so it has to be complete. Which file is in
 *   effect is always obvious.
 * - `"merge"` layers higher-priority files over lower ones, key by key, so a project
 *   config can override one setting and inherit the rest.
 *
 * Merging is **shallow**: a nested object in a project file replaces its global
 * counterpart wholesale rather than being merged into it. For a config shaped like
 * `{ phoenix: { endpoint, project } }`, setting `phoenix.project` in a project file
 * therefore drops the global `phoenix.endpoint` — flat config shapes merge far more
 * predictably than nested ones.
 */
export type ConfigStrategy = "first-match" | "merge";

export interface LoadConfigOptions extends ConfigLocationOptions {
  /** Defaults to `"first-match"`. */
  strategy?: ConfigStrategy;
}

export interface LoadedConfig<T> {
  /** Defaults with every contributing file applied over them. */
  config: T;
  /**
   * The files that contributed, lowest priority first, so the last entry is the one
   * that had the final say. Empty when nothing readable was found.
   */
  sources: string[];
  /** Every candidate path in priority order, whether or not it existed. */
  candidates: string[];
  /**
   * Problems worth surfacing to the user: files that existed but could not be used.
   * Reporting is left to the caller — a library has no business writing to the console.
   */
  diagnostics: string[];
}

/**
 * Read config from disk, applied over `defaults`.
 *
 * A file that exists but holds malformed JSON (or a non-object) is reported in
 * `diagnostics` and skipped, falling through to the next location: a stray project
 * config should not strand an extension with no configuration at all.
 */
export function loadConfig<T extends object>(
  extensionId: string,
  defaults: T,
  options: LoadConfigOptions = {},
): LoadedConfig<T> {
  const strategy = options.strategy ?? "first-match";
  const candidates = getConfigPaths(extensionId, options);
  const diagnostics: string[] = [];
  const found: Array<{ path: string; values: Partial<T> }> = [];

  for (const path of candidates) {
    const values = readConfigFile<T>(path, diagnostics);
    if (!values) continue;

    found.push({ path, values });
    if (strategy === "first-match") break;
  }

  // `candidates` runs highest priority first, so apply it back to front and let the
  // higher-priority file win. Under "first-match" there is at most one entry anyway.
  const contributing = found.reverse();

  let config = { ...defaults };
  for (const { values } of contributing) {
    config = { ...config, ...values };
  }

  return {
    config,
    sources: contributing.map(({ path }) => path),
    candidates,
    diagnostics,
  };
}

/**
 * Parse one config file. Returns `null` when it is absent or unusable, appending a
 * note to `diagnostics` in the latter case.
 */
function readConfigFile<T extends object>(
  path: string,
  diagnostics: string[],
): Partial<T> | null {
  if (!existsSync(path)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    diagnostics.push(`${path} is not valid JSON (${reason}); ignoring it.`);
    return null;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    diagnostics.push(`${path} must hold a JSON object; ignoring it.`);
    return null;
  }

  return parsed as Partial<T>;
}
