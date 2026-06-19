<div align="center">

# dep-graph

**Visualize your project's import dependency graph — spot circular deps and orphaned files in seconds.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?labelColor=0B0A09)](LICENSE)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?labelColor=0B0A09)](package.json)
[![Node >=18](https://img.shields.io/badge/node-%3E%3D18-green?labelColor=0B0A09)](package.json)

</div>

## Install

```bash
npx github:NickCirv/dep-graph
```

## Usage

```bash
# Full dependency tree for the current project
npx github:NickCirv/dep-graph

# Find circular dependency chains only
npx github:NickCirv/dep-graph --circular

# Find orphaned files (not imported by anything)
npx github:NickCirv/dep-graph --orphans

# Inspect a single file's imports and importers
npx github:NickCirv/dep-graph --file src/index.js

# Export as Graphviz DOT (pipe to dot for an SVG)
npx github:NickCirv/dep-graph --format dot | dot -Tsvg > graph.svg
```

| Flag | Description |
|------|-------------|
| `--circular` | Find circular dependency chains |
| `--orphans` | Find orphaned files (no imports, not imported) |
| `--file <path>` | Show imports and importers for one file |
| `--entry <path>` | Start the tree from a specific entry file |
| `--depth <n>` | Limit tree depth (default: unlimited) |
| `--format dot\|json\|text` | Output format (default: text) |
| `--ignore <pattern>` | Exclude files matching pattern (repeatable) |
| `--no-external` | Skip external package imports |
| `--root <dir>` | Project root (default: cwd) |
| `-h, --help` | Show help |

## What it does

`dep-graph` walks your JS/TS source tree, parses every `import`, `export … from`, `require()`, and dynamic `import()` statement, and builds a directed graph of file relationships. It detects circular dependency chains via DFS, flags orphaned files with no inbound or outbound edges, and can export the graph as a text tree, Graphviz DOT, or JSON. Supports `.js`, `.mjs`, `.cjs`, `.ts`, `.jsx`, and `.tsx` — zero external dependencies, no config needed.

---
<sub>Zero dependencies · Node ≥18 · MIT · by <a href="https://github.com/NickCirv">NickCirv</a></sub>
