/**
 * Shared config-file resolution for pi extensions.
 *
 * Every extension looks for `config.json` in the same two places, in this order:
 *
 *  1. Project: `<repo-root>/.pi/extensions/<extension-id>/config.json`
 *  2. Global:  `<agent-dir>/extensions/<extension-id>/config.json`
 *
 * The first file that exists and parses is the only one read, so a project config
 * replaces the global one rather than overriding individual fields. Defaults still
 * fill in whatever the winning file leaves out.
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

export interface LoadedConfig<T> {
  /** Defaults merged with the winning file, or just the defaults if nothing was read. */
  config: T;
  /** The file the config came from, or `null` when no readable config existed. */
  path: string | null;
  /** Every candidate path in priority order, whether or not it existed. */
  candidates: string[];
  /**
   * Problems worth surfacing to the user: files that existed but could not be used.
   * Reporting is left to the caller — a library has no business writing to the console.
   */
  diagnostics: string[];
}

/**
 * Read the first usable config file, merged over `defaults`.
 *
 * A file that exists but holds malformed JSON (or a non-object) is reported in
 * `diagnostics` and skipped, falling through to the next location: a stray project
 * config should not strand an extension with no configuration at all.
 */
export function loadConfig<T extends object>(
  extensionId: string,
  defaults: T,
  options: ConfigLocationOptions = {},
): LoadedConfig<T> {
  const candidates = getConfigPaths(extensionId, options);
  const diagnostics: string[] = [];

  for (const path of candidates) {
    if (!existsSync(path)) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf-8"));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      diagnostics.push(`${path} is not valid JSON (${reason}); ignoring it.`);
      continue;
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      diagnostics.push(`${path} must hold a JSON object; ignoring it.`);
      continue;
    }

    return {
      config: { ...defaults, ...(parsed as Partial<T>) },
      path,
      candidates,
      diagnostics,
    };
  }

  return { config: { ...defaults }, path: null, candidates, diagnostics };
}
