# @graelo/pi-ext-config

Shared config-file resolution for pi extensions.

Every extension that uses this reads `config.json` from the same two places, in
this order:

1. **Project** — `<repo-root>/.pi/extensions/<extension-id>/config.json`, where
    the repo root is found by walking up from the current directory to the
    nearest `.git`
2. **Global** — `<agent-dir>/extensions/<extension-id>/config.json`

The first file that exists and parses is the only one read, so a project config
**replaces** the global one rather than overriding individual fields. Defaults
still fill in whatever the winning file leaves out.

## Install

```sh
npm install @graelo/pi-ext-config
```

`@earendil-works/pi-coding-agent` is a peer dependency — the same one your
extension already declares.

## Use

```ts
import { loadConfig } from "@graelo/pi-ext-config";

interface MyConfig {
  url: string;
  timeoutMs: number;
}

const DEFAULTS: MyConfig = { url: "http://localhost:8080", timeoutMs: 30000 };

const { config, path, diagnostics } = loadConfig("pi-my-extension", DEFAULTS, {
  cwd: ctx.cwd,
});

for (const problem of diagnostics) console.warn(problem);
if (path) console.info(`Loaded config from ${path}`);
```

Pass `ctx.cwd` when you have it. Without it the repo root is resolved from
`process.cwd()`, which is usually right but not always the directory the user
means.

## API

### `loadConfig<T>(extensionId, defaults, options?): LoadedConfig<T>`

Reads the first usable config file, merged over `defaults`.

```ts
interface LoadedConfig<T> {
  config: T;              // defaults merged with the winning file
  path: string | null;    // the file it came from, null if none was readable
  candidates: string[];   // every candidate path, in priority order
  diagnostics: string[];  // files that existed but could not be used
}
```

A file that exists but holds malformed JSON (or something that isn't a JSON
object) is reported in `diagnostics` and skipped, falling through to the next
location — a stray project config should not strand an extension with no
configuration at all.

Nothing is written to the console: reporting is the extension's call, since only
it knows whether that means `console.warn` or `ctx.ui.notify`.

### `getConfigPaths(extensionId, options?): string[]`

Candidate paths in priority order, whether or not they exist. Useful for an
error message that tells the user where a config file could go.

The project path is **omitted entirely** when the working directory is not
inside a git repository — a bare `./.pi/extensions/...` relative to wherever the
agent happens to have been started is not something anyone means to configure.

### `resolveConfigPath(extensionId, options?): string | null`

The file `loadConfig` would read, or `null` when none of the candidates exist.
Only checks existence — a file holding malformed JSON is still returned.

### `findGitRoot(startPath): string | null`

Walks up from `startPath` to the enclosing repository root, or `null` if there
isn't one.

`.git` is a directory in a normal clone but a **file** in worktrees and
submodules, so mere existence marks the root. Never add an `isDirectory()` check
here — it breaks both.

### `ConfigLocationOptions`

```ts
interface ConfigLocationOptions {
  cwd?: string;       // where to start looking for the repo root; default process.cwd()
  agentDir?: string;  // overrides the agent directory; intended for tests
}
```

`agentDir` defaults to pi's own `getAgentDir()`, which already honours
`PI_CODING_AGENT_DIR` and expands a leading `~`. Do not re-implement that chain:
pi derives the variable name from its own branding, so a hand-rolled
`process.env.PI_CODING_AGENT_DIR` silently reads the wrong variable under a
rebranded build.

## Design notes

Three decisions this library settles once, which the extensions previously each
answered differently:

- **Global tier** — always `getAgentDir()`, never a hand-rolled env chain.
- **No repository** — skip the project tier rather than falling back to `cwd`.
- **Malformed project file** — fall through to global with a diagnostic,
    rather than giving up.

## License

MIT
