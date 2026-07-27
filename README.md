# @graelo/pi-ext-config

Shared config-file resolution for pi extensions.

Every extension that uses this reads `config.json` from the same two places, in
this order:

1. **Project** — `<repo-root>/.pi/extensions/<extension-id>/config.json`, where
    the repo root is found by walking up from the current directory to the
    nearest `.git`
2. **Global** — `<agent-dir>/extensions/<extension-id>/config.json`

What happens when both exist is yours to choose, per extension:

| `strategy` | behaviour |
| --- | --- |
| `"first-match"` (default) | Only the project file is read. It **replaces** the global one, so it has to be complete. Which file is in effect is always obvious. |
| `"merge"` | The project file is layered **over** the global one, key by key, so it can override one setting and inherit the rest. |

Defaults always sit underneath whatever is read.

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

const { config, sources, diagnostics } = loadConfig("pi-my-extension", DEFAULTS, {
  cwd: ctx.cwd,
});

for (const problem of diagnostics) console.warn(problem);
for (const source of sources) console.info(`Loaded config from ${source}`);
```

To layer a project config over the global one instead:

```ts
const { config } = loadConfig("pi-my-extension", DEFAULTS, {
  cwd: ctx.cwd,
  strategy: "merge",
});
```

Pass `ctx.cwd` when you have it. Without it the repo root is resolved from
`process.cwd()`, which is usually right but not always the directory the user
means.

## API

### `loadConfig<T>(extensionId, defaults, options?): LoadedConfig<T>`

Reads config from disk, applied over `defaults`.

```ts
interface LoadedConfig<T> {
  config: T;              // defaults with every contributing file applied over them
  sources: string[];      // files that contributed, lowest priority first
  candidates: string[];   // every candidate path, in priority order
  diagnostics: string[];  // files that existed but could not be used
}
```

`sources` is empty when nothing readable was found, and holds at most one entry
under `"first-match"`. Its **last** entry is the file that had the final say,
under either strategy — that's the one to name in a "loaded config from…" line.

A file that exists but holds malformed JSON (or something that isn't a JSON
object) is reported in `diagnostics` and skipped, falling through to the next
location — a stray project config should not strand an extension with no
configuration at all. This holds under both strategies.

Nothing is written to the console: reporting is the extension's call, since only
it knows whether that means `console.warn` or `ctx.ui.notify`.

#### Choosing a strategy

`"first-match"` suits config that is small or whose keys travel together — a
project file is then a deliberate, complete statement, and there is never any
doubt about which file is live. `"merge"` suits config with several independent
knobs, where a repo wants to change one and inherit the rest.

One caveat for `"merge"`: it is **shallow**. A nested object in a project file
replaces its global counterpart wholesale rather than being merged into it. For
a config shaped like `{ phoenix: { endpoint, project } }`, setting
`phoenix.project` in a project file drops the global `phoenix.endpoint` — which
is exactly the surprise `"merge"` was supposed to avoid. Flat config shapes
merge predictably; nested ones do not.

### `getConfigPaths(extensionId, options?): string[]`

Candidate paths in priority order, whether or not they exist. Useful for an
error message that tells the user where a config file could go.

The project path is **omitted entirely** when the working directory is not
inside a git repository — a bare `./.pi/extensions/...` relative to wherever the
agent happens to have been started is not something anyone means to configure.

### `resolveConfigPath(extensionId, options?): string | null`

The highest-priority config file that exists, or `null` when none do. Only
checks existence — a file holding malformed JSON is still returned.

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

interface LoadConfigOptions extends ConfigLocationOptions {
  strategy?: "first-match" | "merge"; // default "first-match"
}
```

`agentDir` defaults to pi's own `getAgentDir()`, which already honours
`PI_CODING_AGENT_DIR` and expands a leading `~`. Do not re-implement that chain:
pi derives the variable name from its own branding, so a hand-rolled
`process.env.PI_CODING_AGENT_DIR` silently reads the wrong variable under a
rebranded build.

## Design notes

Decisions this library settles once, which the extensions previously each
answered differently:

- **Global tier** — always `getAgentDir()`, never a hand-rolled env chain.
- **No repository** — skip the project tier rather than falling back to `cwd`.
- **Malformed project file** — fall through to global with a diagnostic,
    rather than giving up.

Combining files is deliberately *not* one of them: both `"first-match"` and
`"merge"` are defensible, they suit different config shapes, and the choice
belongs to whoever wrote the extension. What matters is that the location and
detection rules are identical either way.

## License

MIT
