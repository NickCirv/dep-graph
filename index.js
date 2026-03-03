#!/usr/bin/env node
// dep-graph — Visualize your project's import dependency graph
// Zero external dependencies · Node 18+

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { resolve, relative, dirname, extname, join } from 'path';

// ─── Argument Parsing ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    help: false,
    circular: false,
    orphans: false,
    noExternal: false,
    format: 'text',
    depth: Infinity,
    entry: null,
    file: null,
    ignore: [],
    root: process.cwd(),
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--circular') opts.circular = true;
    else if (a === '--orphans') opts.orphans = true;
    else if (a === '--no-external') opts.noExternal = true;
    else if (a === '--format' || a === '-f') opts.format = args[++i];
    else if (a === '--depth' || a === '-d') opts.depth = parseInt(args[++i], 10);
    else if (a === '--entry' || a === '-e') opts.entry = args[++i];
    else if (a === '--file') opts.file = args[++i];
    else if (a === '--ignore' || a === '-i') opts.ignore.push(args[++i]);
    else if (a === '--root') opts.root = args[++i];
  }

  return opts;
}

// ─── File Discovery ──────────────────────────────────────────────────────────

const SUPPORTED_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '.next', 'out', '.nuxt', '.cache']);

function walkDir(dir, ignorePatterns) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    if (SKIP_DIRS.has(entry)) continue;

    const fullPath = join(dir, entry);
    const relPath = relative(process.cwd(), fullPath);

    if (ignorePatterns.some(p => relPath.includes(p) || entry.includes(p))) continue;

    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      results.push(...walkDir(fullPath, ignorePatterns));
    } else if (SUPPORTED_EXTS.has(extname(entry))) {
      results.push(fullPath);
    }
  }

  return results;
}

// ─── Import Parsing ──────────────────────────────────────────────────────────

const IMPORT_PATTERNS = [
  /(?:import|export)(?:\s+[\w*{},\s]+\s+from)?\s+['"]([^'"]+)['"]/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function parseImports(filePath) {
  let src;
  try {
    src = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const imports = [];
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(src)) !== null) {
      imports.push(match[1]);
    }
  }
  return imports;
}

function resolveImport(from, importPath) {
  if (!importPath.startsWith('.')) return null;

  const base = resolve(dirname(from), importPath);

  if (existsSync(base) && SUPPORTED_EXTS.has(extname(base))) return base;

  for (const ext of SUPPORTED_EXTS) {
    const candidate = base + ext;
    if (existsSync(candidate)) return candidate;
  }

  for (const ext of SUPPORTED_EXTS) {
    const candidate = join(base, 'index' + ext);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

// ─── Graph Building ──────────────────────────────────────────────────────────

function buildGraph(files, opts) {
  const graph = new Map();
  const reverseGraph = new Map();

  for (const f of files) {
    if (!graph.has(f)) graph.set(f, new Set());
    if (!reverseGraph.has(f)) reverseGraph.set(f, new Set());
  }

  const fileSet = new Set(files);

  for (const filePath of files) {
    const imports = parseImports(filePath);
    for (const imp of imports) {
      if (!imp.startsWith('.') && opts.noExternal) continue;
      const resolved = resolveImport(filePath, imp);
      if (resolved && fileSet.has(resolved)) {
        graph.get(filePath).add(resolved);
        reverseGraph.get(resolved).add(filePath);
      }
    }
  }

  return { graph, reverseGraph };
}

// ─── Circular Detection ──────────────────────────────────────────────────────

function findCircular(graph) {
  const cycles = [];
  const visited = new Set();
  const inStack = new Set();
  const stack = [];

  function dfs(node) {
    visited.add(node);
    inStack.add(node);
    stack.push(node);

    for (const neighbor of (graph.get(node) || [])) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (inStack.has(neighbor)) {
        const cycleStart = stack.indexOf(neighbor);
        const cycle = stack.slice(cycleStart).concat(neighbor);
        cycles.push(cycle);
      }
    }

    stack.pop();
    inStack.delete(node);
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  return cycles;
}

// ─── Orphan Detection ────────────────────────────────────────────────────────

function findOrphans(graph, reverseGraph, entryFile) {
  const orphans = [];
  for (const [file, deps] of graph.entries()) {
    const importedBy = reverseGraph.get(file) || new Set();
    const isEntry = file === entryFile;
    if (!isEntry && importedBy.size === 0 && deps.size === 0) {
      orphans.push(file);
    }
  }
  return orphans;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

function computeStats(graph, reverseGraph) {
  const totalFiles = graph.size;
  let totalEdges = 0;
  for (const deps of graph.values()) totalEdges += deps.size;

  const avgDeps = totalFiles > 0 ? (totalEdges / totalFiles).toFixed(1) : 0;

  const mostDepended = [...reverseGraph.entries()]
    .map(([f, importers]) => ({ file: f, count: importers.size }))
    .filter(x => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { totalFiles, totalEdges, avgDeps, mostDepended };
}

// ─── ASCII Tree Rendering ────────────────────────────────────────────────────

function rel(filePath) {
  return relative(process.cwd(), filePath);
}

function renderTree(rootNode, graph, maxDepth) {
  const lines = [];
  const shownSet = new Set();

  function renderNode(node, prefix, depth) {
    const r = rel(node);
    const wasShown = shownSet.has(node);
    shownSet.add(node);
    lines.push(prefix + r + (wasShown && depth > 0 ? '  (↑ shown)' : ''));
    if (wasShown || depth >= maxDepth) return;

    const deps = [...(graph.get(node) || [])];
    for (let i = 0; i < deps.length; i++) {
      const isLast = i === deps.length - 1;
      const nextPrefix = prefix.replace(/├── $/, '│   ').replace(/└── $/, '    ');
      renderNode(deps[i], nextPrefix + (isLast ? '└── ' : '├── '), depth + 1);
    }
  }

  renderNode(rootNode, '', 0);
  return lines.join('\n');
}

// ─── DOT Format ──────────────────────────────────────────────────────────────

function renderDot(graph) {
  const lines = ['digraph deps {', '  rankdir=LR;', '  node [shape=box fontname="monospace"];'];
  for (const [from, deps] of graph.entries()) {
    for (const to of deps) {
      lines.push(`  "${rel(from)}" -> "${rel(to)}";`);
    }
  }
  lines.push('}');
  return lines.join('\n');
}

// ─── JSON Format ─────────────────────────────────────────────────────────────

function renderJson(graph, reverseGraph, cycles, orphans, stats) {
  const nodes = [];
  for (const [file, deps] of graph.entries()) {
    nodes.push({
      file: rel(file),
      imports: [...deps].map(rel),
      importedBy: [...(reverseGraph.get(file) || [])].map(rel),
    });
  }
  return JSON.stringify(
    {
      stats,
      nodes,
      cycles: cycles.map(c => c.map(rel)),
      orphans: orphans.map(rel),
    },
    null,
    2
  );
}

// ─── Help ────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
dep-graph — Visualize your project's import dependency graph

USAGE
  npx dep-graph [options]
  dg [options]

OPTIONS
  --file <path>       Analyze deps for a specific file
  --entry <path>      Start tree from this entry file
  --circular          Find circular dependencies only
  --orphans           Find orphaned files (no imports, not imported)
  --depth <n>         Limit tree depth (default: unlimited)
  --format <fmt>      Output format: text (default), dot, json
  --ignore <pattern>  Ignore files matching pattern (repeatable)
  --no-external       Exclude external package imports
  --root <dir>        Project root (default: cwd)
  -h, --help          Show this help

EXAMPLES
  npx dep-graph
  npx dep-graph --circular
  npx dep-graph --orphans
  npx dep-graph --file src/index.js
  npx dep-graph --entry src/main.js --depth 3
  npx dep-graph --format dot | dot -Tsvg > graph.svg
  npx dep-graph --format json > deps.json
`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const rootDir = resolve(opts.root);
  const files = walkDir(rootDir, opts.ignore);

  if (files.length === 0) {
    console.error('No JS/TS files found in', rootDir);
    process.exit(1);
  }

  const { graph, reverseGraph } = buildGraph(files, opts);

  // ── Single file mode ──
  if (opts.file) {
    const target = resolve(opts.file);
    if (!graph.has(target)) {
      console.error('File not found in graph:', opts.file);
      process.exit(1);
    }
    const deps = graph.get(target);
    const importedBy = reverseGraph.get(target) || new Set();
    console.log(`\n${rel(target)}`);
    if (deps.size > 0) {
      console.log('\nImports:');
      for (const d of deps) console.log('  \u2192 ' + rel(d));
    } else {
      console.log('  (no local imports)');
    }
    if (importedBy.size > 0) {
      console.log('\nImported by:');
      for (const d of importedBy) console.log('  \u2190 ' + rel(d));
    }
    return;
  }

  // ── Circular only mode ──
  if (opts.circular) {
    const cycles = findCircular(graph);
    if (cycles.length === 0) {
      console.log('\u2713 No circular dependencies found.');
    } else {
      console.log(`\u26a0  Found ${cycles.length} circular dependency chain(s):\n`);
      for (const cycle of cycles) {
        console.log('  ' + cycle.map(rel).join(' \u2192 '));
      }
    }
    return;
  }

  // ── Orphans only mode ──
  if (opts.orphans) {
    const entryFile = opts.entry ? resolve(opts.entry) : null;
    const orphans = findOrphans(graph, reverseGraph, entryFile);
    if (orphans.length === 0) {
      console.log('\u2713 No orphaned files found.');
    } else {
      console.log(`Found ${orphans.length} orphaned file(s):\n`);
      for (const o of orphans) console.log('  ' + rel(o));
    }
    return;
  }

  // ── Full analysis ──
  const stats = computeStats(graph, reverseGraph);
  const cycles = findCircular(graph);
  const entryFile = opts.entry ? resolve(opts.entry) : null;
  const orphans = findOrphans(graph, reverseGraph, entryFile);

  if (opts.format === 'dot') {
    console.log(renderDot(graph));
    return;
  }

  if (opts.format === 'json') {
    console.log(renderJson(graph, reverseGraph, cycles, orphans, stats));
    return;
  }

  // ── Text / ASCII tree ──
  const divider = '\u2501'.repeat(39);

  console.log(`\ndep-graph \u00b7 ${stats.totalFiles} files \u00b7 ${stats.totalEdges} edges`);
  console.log(divider);
  console.log('');

  // Roots = files with no inbound edges (or specified entry)
  let roots;
  if (entryFile && graph.has(entryFile)) {
    roots = [entryFile];
  } else {
    roots = [...graph.keys()].filter(f => (reverseGraph.get(f) || new Set()).size === 0);
    if (roots.length === 0) roots = [...graph.keys()].slice(0, 1);
  }

  for (const r of roots) {
    console.log(renderTree(r, graph, opts.depth));
    console.log('');
  }

  if (cycles.length > 0) {
    for (const cycle of cycles) {
      console.log('\u26a0  Circular: ' + cycle.map(rel).join(' \u2192 '));
    }
    console.log('');
  }

  if (orphans.length > 0) {
    console.log(`Orphaned files (${orphans.length}):`);
    for (const o of orphans) console.log('  ' + rel(o));
    console.log('');
  }

  if (stats.mostDepended.length > 0) {
    console.log('Most depended upon:');
    for (const { file, count } of stats.mostDepended) {
      console.log(`  ${rel(file).padEnd(40)} imported by ${count} file${count !== 1 ? 's' : ''}`);
    }
  }

  console.log(divider);
  console.log(`avg deps/file: ${stats.avgDeps}\n`);
}

main().catch(err => {
  console.error('dep-graph error:', err.message);
  process.exit(1);
});
