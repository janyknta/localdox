/**
 * Synthetic flowcharts for benchmarking, shaped like real architecture maps.
 *
 * A pure tree would flatter every layout engine (no crossings to minimise), and
 * a random graph would punish them unrealistically. This is a branching tree
 * of fan-out 3 with a cross-link every fifth node back to an earlier one, which
 * is roughly what a large service map or import graph looks like: mostly
 * hierarchical, with enough joins to make crossing reduction do real work.
 *
 * Seeded, so every run and every engine sees the same diagram.
 */

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SyntheticGraph {
  nodes: number;
  edges: [number, number][];
}

export function syntheticGraph(nodes: number, seed = 42): SyntheticGraph {
  const random = rng(seed);
  const edges: [number, number][] = [];
  for (let index = 1; index < nodes; index++) {
    edges.push([Math.floor((index - 1) / 3), index]);
    if (index % 5 === 0 && index > 10) {
      // A join from somewhere earlier, biased towards nearby ranks so the
      // layout stays plausible rather than a hairball.
      const from = Math.max(0, index - 1 - Math.floor(random() * Math.min(index - 1, 60)));
      if (from !== Math.floor((index - 1) / 3)) edges.push([from, index]);
    }
  }
  return { nodes, edges };
}

export function syntheticFlowchart(nodes: number, seed = 42): string {
  const graph = syntheticGraph(nodes, seed);
  const lines = ["flowchart TD"];
  for (let index = 0; index < graph.nodes; index++) lines.push(`  n${index}["Service ${index}"]`);
  for (const [from, to] of graph.edges) lines.push(`  n${from} --> n${to}`);
  return lines.join("\n");
}

/**
 * A schema-shaped ER diagram: entities of `columns` attributes each, every
 * entity owned by an earlier one plus occasional many-to-many links — the
 * shape of an imported database, where the rows dominate the element count.
 */
export function syntheticEr(entities: number, columns = 8, seed = 7): string {
  const random = rng(seed);
  const types = ["int", "varchar(255)", "timestamp", "boolean", "numeric", "text"];
  const lines = ["erDiagram"];
  for (let i = 0; i < entities; i++) {
    lines.push(`  TABLE_${i} {`);
    lines.push(`    int id PK "primary key"`);
    for (let c = 1; c < columns; c++) {
      const type = types[Math.floor(random() * types.length)];
      lines.push(`    ${type} column_${c}${c === 1 && i > 0 ? " FK" : ""}`);
    }
    lines.push("  }");
  }
  for (let i = 1; i < entities; i++) {
    lines.push(`  TABLE_${Math.floor((i - 1) / 3)} ||--o{ TABLE_${i} : owns`);
    if (i % 7 === 0 && i > 10) {
      const other = Math.max(0, i - 1 - Math.floor(random() * Math.min(i - 1, 40)));
      lines.push(`  TABLE_${i} }o..o{ TABLE_${other} : links`);
    }
  }
  return lines.join("\n");
}
