# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `ConfigLocationOptions.includeProject` optionally disables the project tier.
  It defaults to `true` for backward compatibility; when `false`, config lookup
  uses only the global tier.

## [0.1.0] - 2026-07-28

First release. Nothing was published before this, so everything below is new.

### Added

- `loadConfig()` reads `config.json` from the project tier
    (`<repo-root>/.pi/extensions/<extension-id>/`) and the global tier
    (`<agent-dir>/extensions/<extension-id>/`), applied over caller-supplied
    defaults. It returns the resulting config alongside the contributing
    `sources`, every `candidate` path, and any `diagnostics`.
- Three strategies for combining the two tiers, chosen per extension:
    `"first-match"` (the default) reads only the highest-priority file;
    `"shallow-merge"` layers files by top-level key; `"deep-merge"` layers them
    recursively. Arrays are replaced wholesale under both merge strategies.
- `getConfigPaths()` returns the candidate paths in priority order whether or
    not they exist, so an extension can tell the user where a config file could
    go. The project tier is omitted entirely outside a git repository.
- `resolveConfigPath()` returns the highest-priority file that exists.
- `findGitRoot()` walks up to the enclosing repository root, treating `.git` as
    a marker whether it is a directory or a file, so worktrees and submodules
    resolve correctly.
- The config returned by `loadConfig()` shares no state with the caller's
    defaults, at any depth, so mutating it cannot leak into a module-level
    constant.
- Diagnostics distinguish a file that could not be read from one holding
    invalid JSON or a non-object, and an unusable file falls through to the next
    location rather than stranding the extension. Nothing is ever written to the
    console: reporting is the extension's call.

[Unreleased]: https://github.com/graelo/pi-ext-config/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/graelo/pi-ext-config/releases/tag/v0.1.0
