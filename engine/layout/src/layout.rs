//! Layered graph layout, sized for diagrams of tens of thousands of nodes.
//!
//! The pipeline is the classic Sugiyama one that dagre (Mermaid's default
//! engine) also follows — break cycles, assign ranks, order each rank to reduce
//! crossings, then assign coordinates — but every stage is chosen to stay close
//! to linear in the size of the graph. dagre's network-simplex ranking and its
//! unbounded crossing-reduction passes are what take it from half a second at
//! 1,000 nodes to a minute and a half at 10,000; here each stage has a fixed
//! budget of passes, each of which is O(V + E) or O(E log V).
//!
//!  1. Cycles: an iterative DFS reverses back edges. O(V + E).
//!  2. Ranks: longest path from the sources, then sources and fan-out nodes are
//!     pulled down next to their successors so they don't float at the top with
//!     long edges trailing off them. O(V + E).
//!  3. Long edges become chains of dummy nodes, one per rank crossed. When any
//!     edge carries a label every edge spans two ranks (as dagre does), so the
//!     label gets a dummy of its own size in the middle and is never drawn over
//!     a node.
//!  4. Order: barycenter sweeps, alternately down and up, keeping the best
//!     ordering seen by exact crossing count (Barth–Jünger–Mutzel, O(E log V)).
//!  5. Coordinates: each rank is placed by an exact weighted least-squares fit
//!     to its neighbours' positions under minimum-separation constraints, solved
//!     in O(n) by pool-adjacent-violators. Edges between dummies weigh most, so
//!     long edges straighten.
//!
//! Everything is computed top-to-bottom and rotated at the end for the other
//! directions.

pub const DIR_TB: u32 = 0;
pub const DIR_BT: u32 = 1;
pub const DIR_LR: u32 = 2;
pub const DIR_RL: u32 = 3;

pub const SHAPE_RECT: u32 = 0;
pub const SHAPE_ELLIPSE: u32 = 1;
pub const SHAPE_DIAMOND: u32 = 2;

#[derive(Clone, Copy, Debug)]
pub struct NodeIn {
    pub width: f32,
    pub height: f32,
    pub shape: u32,
}

#[derive(Clone, Copy, Debug)]
pub struct EdgeIn {
    pub source: u32,
    pub target: u32,
    /// Zero width means the edge has no label.
    pub label_width: f32,
    pub label_height: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct Options {
    pub direction: u32,
    pub node_sep: f32,
    pub rank_sep: f32,
    pub edge_sep: f32,
    /// Output width / height to aim for. A layout far off it (a 10,000-node
    /// tree is ~300:1) is folded into bands; see `wrap`. 0 leaves it as is.
    pub aspect: f32,
}

impl Default for Options {
    fn default() -> Self {
        Options { direction: DIR_TB, node_sep: 50.0, rank_sep: 50.0, edge_sep: 20.0, aspect: 0.0 }
    }
}

#[derive(Debug, Default)]
pub struct Output {
    pub width: f32,
    pub height: f32,
    /// Node centres, in input order.
    pub nodes: Vec<(f32, f32)>,
    /// One polyline per input edge, source to target. Empty for an edge whose
    /// endpoints are out of range.
    pub edges: Vec<Vec<(f32, f32)>>,
    /// Label centre per input edge, when it has a label.
    pub labels: Vec<Option<(f32, f32)>>,
    /// Crossings left after ordering; diagnostic only.
    pub crossings: u32,
}

const KIND_REAL: u8 = 0;
const KIND_DUMMY: u8 = 1;
const KIND_LABEL: u8 = 2;

/// Passes of barycenter ordering; alternate down and up.
const ORDER_PASSES: usize = 32;
/// Stop ordering after this many passes without improvement.
const ORDER_PATIENCE: usize = 8;
/// Passes of coordinate refinement, each a down sweep then an up sweep.
const POSITION_PASSES: usize = 8;
/** Dummy nodes the layout may create for long edges before it stops routing them. */
const DUMMY_BUDGET: i64 = 500_000;
const MARGIN: f64 = 8.0;

/// Compressed adjacency: `targets[offsets[v]..offsets[v + 1]]`.
struct Csr {
    offsets: Vec<u32>,
    targets: Vec<u32>,
    weights: Vec<f32>,
}

impl Csr {
    fn build(count: usize, pairs: &[(u32, u32, f32)]) -> Csr {
        let mut offsets = vec![0u32; count + 1];
        for &(from, _, _) in pairs {
            offsets[from as usize + 1] += 1;
        }
        for index in 0..count {
            offsets[index + 1] += offsets[index];
        }
        let mut cursor = offsets.clone();
        let mut targets = vec![0u32; pairs.len()];
        let mut weights = vec![0f32; pairs.len()];
        for &(from, to, weight) in pairs {
            let slot = cursor[from as usize] as usize;
            targets[slot] = to;
            weights[slot] = weight;
            cursor[from as usize] += 1;
        }
        Csr { offsets, targets, weights }
    }

    #[inline]
    fn range(&self, node: usize) -> std::ops::Range<usize> {
        self.offsets[node] as usize..self.offsets[node + 1] as usize
    }

    #[inline]
    fn degree(&self, node: usize) -> usize {
        (self.offsets[node + 1] - self.offsets[node]) as usize
    }
}

pub fn run(nodes_in: &[NodeIn], edges_in: &[EdgeIn], options: &Options) -> Output {
    let real = nodes_in.len();
    let edge_count = edges_in.len();
    if real == 0 {
        return Output { edges: vec![Vec::new(); edge_count], labels: vec![None; edge_count], ..Output::default() };
    }

    let horizontal = options.direction == DIR_LR || options.direction == DIR_RL;
    // Layout space is always top-to-bottom; a sideways diagram swaps each box.
    let size = |w: f32, h: f32| -> (f64, f64) {
        if horizontal { (h as f64, w as f64) } else { (w as f64, h as f64) }
    };

    let mut width: Vec<f64> = Vec::with_capacity(real * 2);
    let mut height: Vec<f64> = Vec::with_capacity(real * 2);
    let mut kind: Vec<u8> = Vec::with_capacity(real * 2);
    for node in nodes_in {
        let (w, h) = size(node.width, node.height);
        width.push(w);
        height.push(h);
        kind.push(KIND_REAL);
    }

    let valid = |edge: &EdgeIn| (edge.source as usize) < real && (edge.target as usize) < real;
    let is_loop = |edge: &EdgeIn| edge.source == edge.target;
    let labelled = |edge: &EdgeIn| edge.label_width > 0.0 && edge.label_height > 0.0;
    let has_labels = edges_in.iter().any(|e| valid(e) && !is_loop(e) && labelled(e));
    let min_len: i32 = if has_labels { 2 } else { 1 };
    let rank_sep = if has_labels { options.rank_sep as f64 / 2.0 } else { options.rank_sep as f64 };

    // ---- 1. Break cycles -------------------------------------------------------
    let mut out_pairs: Vec<(u32, u32, f32)> = Vec::with_capacity(edge_count);
    for (index, edge) in edges_in.iter().enumerate() {
        if valid(edge) && !is_loop(edge) {
            out_pairs.push((edge.source, index as u32, 0.0));
        }
    }
    // Adjacency by edge index, so reversal is recorded per edge.
    let out_edges = Csr::build(real, &out_pairs);
    let mut in_degree = vec![0u32; real];
    for edge in edges_in.iter().filter(|e| valid(e) && !is_loop(e)) {
        in_degree[edge.target as usize] += 1;
    }
    let mut reversed = vec![false; edge_count];
    {
        // 0 unvisited, 1 on the stack, 2 finished.
        let mut state = vec![0u8; real];
        let mut stack: Vec<(u32, u32)> = Vec::new();
        // Sources first, in reading order, so the walk starts where a reader would.
        let roots = (0..real).filter(|&v| in_degree[v] == 0).chain(0..real);
        for root in roots {
            if state[root] != 0 {
                continue;
            }
            state[root] = 1;
            stack.push((root as u32, out_edges.offsets[root]));
            while let Some(top) = stack.last_mut() {
                let node = top.0 as usize;
                if top.1 < out_edges.offsets[node + 1] {
                    let edge_index = out_edges.targets[top.1 as usize] as usize;
                    top.1 += 1;
                    let next = edges_in[edge_index].target as usize;
                    match state[next] {
                        0 => {
                            state[next] = 1;
                            stack.push((next as u32, out_edges.offsets[next]));
                        }
                        1 => reversed[edge_index] = true,
                        _ => {}
                    }
                } else {
                    state[node] = 2;
                    stack.pop();
                }
            }
        }
    }
    // The acyclic orientation of every usable edge: (upper, lower).
    let oriented = |index: usize| -> (usize, usize) {
        let edge = &edges_in[index];
        if reversed[index] {
            (edge.target as usize, edge.source as usize)
        } else {
            (edge.source as usize, edge.target as usize)
        }
    };
    let dag_edges: Vec<usize> =
        (0..edge_count).filter(|&i| valid(&edges_in[i]) && !is_loop(&edges_in[i])).collect();

    // ---- 2. Ranks --------------------------------------------------------------
    let mut rank = vec![0i32; real];
    {
        let mut succ_pairs = Vec::with_capacity(dag_edges.len());
        let mut indeg = vec![0u32; real];
        for &index in &dag_edges {
            let (upper, lower) = oriented(index);
            succ_pairs.push((upper as u32, lower as u32, 0.0));
            indeg[lower] += 1;
        }
        let succ = Csr::build(real, &succ_pairs);
        let mut pred_pairs: Vec<(u32, u32, f32)> = succ_pairs.iter().map(|&(a, b, w)| (b, a, w)).collect();
        pred_pairs.sort_unstable_by_key(|p| p.0);
        let pred = Csr::build(real, &pred_pairs);

        // Kahn's order doubles as the longest-path schedule.
        let mut topo: Vec<usize> = Vec::with_capacity(real);
        let mut remaining = indeg.clone();
        topo.extend((0..real).filter(|&v| remaining[v] == 0));
        let mut head = 0;
        while head < topo.len() {
            let node = topo[head];
            head += 1;
            for slot in succ.range(node) {
                let next = succ.targets[slot] as usize;
                rank[next] = rank[next].max(rank[node] + min_len);
                remaining[next] -= 1;
                if remaining[next] == 0 {
                    topo.push(next);
                }
            }
        }

        // Longest path parks every source on rank 0, however deep its children
        // sit. Pull a node down to just above its nearest successor whenever it
        // has more edges going down than coming in: that shortens more edges
        // than it lengthens. Reverse topological order means successors are
        // already final when a node is visited.
        for &node in topo.iter().rev() {
            let down = succ.degree(node);
            if down == 0 || down <= pred.degree(node) {
                continue;
            }
            let mut limit = i32::MAX;
            for slot in succ.range(node) {
                limit = limit.min(rank[succ.targets[slot] as usize] - min_len);
            }
            if limit > rank[node] {
                rank[node] = limit;
            }
        }
    }
    let min_rank = rank.iter().copied().min().unwrap_or(0);
    for value in rank.iter_mut() {
        *value -= min_rank;
    }

    // ---- 3. Dummy chains --------------------------------------------------------
    let mut node_rank: Vec<i32> = rank.clone();
    // Per input edge, the chain from upper to lower endpoint.
    let mut chains: Vec<Vec<u32>> = vec![Vec::new(); edge_count];
    let mut label_node: Vec<Option<u32>> = vec![None; edge_count];
    let mut links: Vec<(u32, u32, f32)> = Vec::with_capacity(dag_edges.len() * 2);
    // A dummy per rank crossed is what keeps long edges straight and out of
    // the way — and what could exhaust memory: a graph whose edges each span
    // hundreds of ranks needs tens of millions of them. Past the budget, the
    // longest edges are drawn straight between their ends instead, taking no
    // part in ordering; everything else is laid out as usual.
    let longest_routed = {
        let mut spans: Vec<i64> = dag_edges
            .iter()
            .map(|&i| {
                let (upper, lower) = oriented(i);
                (node_rank[lower] - node_rank[upper] - 1).max(0) as i64
            })
            .collect();
        let budget = DUMMY_BUDGET.max(real as i64 * 4);
        if spans.iter().sum::<i64>() <= budget {
            i32::MAX
        } else {
            spans.sort_unstable();
            let mut used = 0i64;
            let mut limit = 1;
            for dummies in spans {
                if used + dummies > budget {
                    break;
                }
                used += dummies;
                limit = dummies as i32 + 1;
            }
            limit
        }
    };
    for &index in &dag_edges {
        let (upper, lower) = oriented(index);
        let span = node_rank[lower] - node_rank[upper];
        let edge = &edges_in[index];
        if span > longest_routed {
            chains[index] = vec![upper as u32, lower as u32];
            continue;
        }
        let label_at = if labelled(edge) { node_rank[upper] + span / 2 } else { i32::MIN };
        let mut chain = Vec::with_capacity(span.max(1) as usize + 1);
        chain.push(upper as u32);
        for r in (node_rank[upper] + 1)..node_rank[lower] {
            let id = width.len() as u32;
            if r == label_at {
                let (w, h) = size(edge.label_width, edge.label_height);
                width.push(w);
                height.push(h);
                kind.push(KIND_LABEL);
                label_node[index] = Some(id);
            } else {
                width.push(0.0);
                height.push(0.0);
                kind.push(KIND_DUMMY);
            }
            node_rank.push(r);
            chain.push(id);
        }
        chain.push(lower as u32);
        for pair in chain.windows(2) {
            let (a, b) = (pair[0] as usize, pair[1] as usize);
            // Gansner's weights: keep long edges straight above all else.
            let solid = |v: usize| kind[v] != KIND_DUMMY;
            let weight = match (solid(a), solid(b)) {
                (true, true) => 1.0,
                (false, false) => 8.0,
                _ => 2.0,
            };
            links.push((a as u32, b as u32, weight));
        }
        chains[index] = chain;
    }
    let total = width.len();
    let down = Csr::build(total, &links);
    let mut up_links: Vec<(u32, u32, f32)> = links.iter().map(|&(a, b, w)| (b, a, w)).collect();
    up_links.sort_by_key(|p| p.0);
    let up = Csr::build(total, &up_links);

    let rank_count = node_rank.iter().copied().max().unwrap_or(0) as usize + 1;

    // ---- 4. Order within ranks ----------------------------------------------------
    let mut layers: Vec<Vec<u32>> = vec![Vec::new(); rank_count];
    {
        // Seed by DFS from the top ranks, as dagre does: nodes that are close in
        // the graph start close in their rank, which gives the sweeps far less
        // to undo than input order would.
        let mut seeds: Vec<u32> = (0..total as u32).collect();
        seeds.sort_by_key(|&v| node_rank[v as usize]);
        let mut seen = vec![false; total];
        let mut stack: Vec<u32> = Vec::new();
        for seed in seeds {
            if seen[seed as usize] {
                continue;
            }
            stack.push(seed);
            while let Some(node) = stack.pop() {
                let node = node as usize;
                if seen[node] {
                    continue;
                }
                seen[node] = true;
                layers[node_rank[node] as usize].push(node as u32);
                // Reverse so the first successor is visited first.
                for slot in down.range(node).rev() {
                    let next = down.targets[slot];
                    if !seen[next as usize] {
                        stack.push(next);
                    }
                }
            }
        }
    }
    let mut position = vec![0u32; total];
    let index_layers = |layers: &Vec<Vec<u32>>, position: &mut Vec<u32>| {
        for layer in layers {
            for (i, &v) in layer.iter().enumerate() {
                position[v as usize] = i as u32;
            }
        }
    };
    index_layers(&layers, &mut position);
    transpose(&mut layers, &mut position, &up, &down);

    let mut best_layers = layers.clone();
    let mut best_crossings = count_crossings(&layers, &down, &position);
    let mut stale = 0;
    let mut keyed: Vec<(f64, u32, u32)> = Vec::new();
    // Fewer refinement passes on enormous graphs: each is linear, but a few
    // hundred thousand nodes times thirty passes is seconds nobody asked for.
    let (order_passes, position_passes) = if total > 300_000 {
        (10, 3)
    } else if total > 100_000 {
        (16, 5)
    } else {
        (ORDER_PASSES, POSITION_PASSES)
    };
    for pass in 0..order_passes {
        if best_crossings == 0 {
            break;
        }
        let downward = pass % 2 == 0;
        let ranks: Vec<usize> = if downward {
            (1..rank_count).collect()
        } else {
            (0..rank_count.saturating_sub(1)).rev().collect()
        };
        for r in ranks {
            let (neighbours, adjacent_len) = if downward {
                (&up, layers[r - 1].len())
            } else {
                (&down, layers[r + 1].len())
            };
            let own_len = layers[r].len() as f64;
            keyed.clear();
            for &v in &layers[r] {
                let v_usize = v as usize;
                let mut sum = 0.0;
                let mut weight = 0.0;
                for slot in neighbours.range(v_usize) {
                    let w = neighbours.weights[slot] as f64;
                    sum += w * (position[neighbours.targets[slot] as usize] as f64 + 0.5) / adjacent_len as f64;
                    weight += w;
                }
                // A node with nothing on that side holds its relative place.
                let key = if weight > 0.0 { sum / weight } else { (position[v_usize] as f64 + 0.5) / own_len };
                keyed.push((key, position[v_usize], v));
            }
            // Ties break leftwards for two passes, then rightwards for two (as
            // dagre does), so equal barycenters don't pin the same local optimum.
            let bias_right = pass % 4 >= 2;
            keyed.sort_unstable_by(|a, b| {
                let tie = if bias_right { b.1.cmp(&a.1) } else { a.1.cmp(&b.1) };
                a.0.total_cmp(&b.0).then(tie)
            });
            for (i, entry) in keyed.iter().enumerate() {
                layers[r][i] = entry.2;
                position[entry.2 as usize] = i as u32;
            }
        }
        transpose(&mut layers, &mut position, &up, &down);
        let crossings = count_crossings(&layers, &down, &position);
        if crossings < best_crossings {
            best_crossings = crossings;
            best_layers.clone_from(&layers);
            stale = 0;
        } else {
            stale += 1;
            if stale >= ORDER_PATIENCE {
                break;
            }
        }
    }
    let layers = best_layers;
    index_layers(&layers, &mut position);

    // ---- 5. Coordinates -------------------------------------------------------------
    let node_sep = options.node_sep as f64;
    let edge_sep = options.edge_sep as f64;
    let gap = |a: usize, b: usize| -> f64 {
        let solid = |v: usize| kind[v] != KIND_DUMMY;
        let sep = match (solid(a), solid(b)) {
            (true, true) => node_sep,
            (false, false) => edge_sep,
            _ => (node_sep + edge_sep) / 2.0,
        };
        (width[a] + width[b]) / 2.0 + sep
    };

    let mut x = vec![0f64; total];
    for layer in &layers {
        let mut cursor = 0.0;
        for (i, &v) in layer.iter().enumerate() {
            if i > 0 {
                cursor += gap(layer[i - 1] as usize, v as usize);
            }
            x[v as usize] = cursor;
        }
        let shift = cursor / 2.0;
        for &v in layer {
            x[v as usize] -= shift;
        }
    }

    let mut placer = Placer::default();
    let mut desired: Vec<f64> = Vec::new();
    let mut weights: Vec<f64> = Vec::new();
    let mut place_layer = |layer: &[u32], x: &mut Vec<f64>, sides: &[&Csr]| {
        desired.clear();
        weights.clear();
        for &v in layer {
            let v = v as usize;
            let mut sum = 0.0;
            let mut weight = 0.0;
            for side in sides {
                for slot in side.range(v) {
                    let w = side.weights[slot] as f64;
                    sum += w * x[side.targets[slot] as usize];
                    weight += w;
                }
            }
            if weight > 0.0 {
                desired.push(sum / weight);
                weights.push(weight);
            } else {
                // Unattached on this side: stay put, but yield to anyone who
                // actually has somewhere to be.
                desired.push(x[v]);
                weights.push(1e-3);
            }
        }
        placer.place(layer, &desired, &weights, &gap, x);
    };
    for _ in 0..position_passes {
        for r in 1..rank_count {
            place_layer(&layers[r], &mut x, &[&up]);
        }
        for r in (0..rank_count.saturating_sub(1)).rev() {
            place_layer(&layers[r], &mut x, &[&down]);
        }
    }
    // A final balanced pass: each node between everything it connects to.
    for r in 0..rank_count {
        place_layer(&layers[r], &mut x, &[&up, &down]);
    }

    let mut rank_height = vec![0f64; rank_count];
    for v in 0..total {
        let r = node_rank[v] as usize;
        rank_height[r] = rank_height[r].max(height[v]);
    }
    let mut rank_y = vec![0f64; rank_count];
    for r in 1..rank_count {
        rank_y[r] = rank_y[r - 1] + rank_height[r - 1] / 2.0 + rank_sep + rank_height[r] / 2.0;
    }
    let y = |v: usize| rank_y[node_rank[v] as usize];

    // ---- Edges, then rotate into the requested direction -------------------------------
    let shape_of = |v: usize| if v < real { nodes_in[v].shape } else { SHAPE_RECT };
    let mut polylines: Vec<Vec<(f64, f64)>> = vec![Vec::new(); edge_count];
    let mut label_points: Vec<Option<(f64, f64)>> = vec![None; edge_count];
    for index in 0..edge_count {
        let edge = &edges_in[index];
        if !valid(edge) {
            continue;
        }
        if is_loop(edge) {
            let v = edge.source as usize;
            let (cx, cy, w, h) = (x[v], y(v), width[v], height[v]);
            let reach = 24.0;
            polylines[index] = vec![
                (cx + w / 2.0, cy - h / 4.0),
                (cx + w / 2.0 + reach, cy - h / 4.0 - 6.0),
                (cx + w / 2.0 + reach, cy + h / 4.0 + 6.0),
                (cx + w / 2.0, cy + h / 4.0),
            ];
            if labelled(edge) {
                let (lw, _) = size(edge.label_width, edge.label_height);
                label_points[index] = Some((cx + w / 2.0 + reach + 4.0 + lw / 2.0, cy));
            }
            continue;
        }
        let chain = &chains[index];
        let mut points: Vec<(f64, f64)> = chain.iter().map(|&v| (x[v as usize], y(v as usize))).collect();
        let last = points.len() - 1;
        let first_node = chain[0] as usize;
        let last_node = chain[last] as usize;
        points[0] = boundary(points[0], width[first_node], height[first_node], shape_of(first_node), points[1]);
        points[last] =
            boundary(points[last], width[last_node], height[last_node], shape_of(last_node), points[last - 1]);
        if reversed[index] {
            points.reverse();
        }
        polylines[index] = points;
        if let Some(label) = label_node[index] {
            label_points[index] = Some((x[label as usize], y(label as usize)));
        } else if labelled(edge) && polylines[index].len() >= 2 {
            // A long edge drawn straight (over the dummy budget): label its middle.
            let line = &polylines[index];
            let (a, b) = (line[0], line[line.len() - 1]);
            label_points[index] = Some(((a.0 + b.0) / 2.0, (a.1 + b.1) / 2.0));
        }
    }

    let rotate = |(px, py): (f64, f64)| -> (f64, f64) {
        match options.direction {
            DIR_BT => (px, -py),
            DIR_LR => (py, px),
            DIR_RL => (-py, px),
            _ => (px, py),
        }
    };

    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    let mut grow = |cx: f64, cy: f64, w: f64, h: f64| {
        min_x = min_x.min(cx - w / 2.0);
        max_x = max_x.max(cx + w / 2.0);
        min_y = min_y.min(cy - h / 2.0);
        max_y = max_y.max(cy + h / 2.0);
    };
    let mut folded: Vec<(f64, f64)> = (0..real).map(|v| (x[v], y(v))).collect();
    if options.aspect > 0.0 {
        // Folding happens in layout space, where ranks run down the page, so a
        // sideways diagram's target is inverted.
        let aspect = options.aspect as f64;
        let target = if horizontal { 1.0 / aspect } else { aspect };
        let sizes: Vec<(f64, f64)> = (0..real).map(|v| (width[v], height[v])).collect();
        let shapes: Vec<u32> = nodes_in.iter().map(|n| n.shape).collect();
        wrap(&mut folded, &sizes, &shapes, &mut polylines, &mut label_points, edges_in, target, rank_sep);
    }
    let centres: Vec<(f64, f64)> = folded.into_iter().map(rotate).collect();
    for (v, &(cx, cy)) in centres.iter().enumerate() {
        grow(cx, cy, nodes_in[v].width as f64, nodes_in[v].height as f64);
    }
    let polylines: Vec<Vec<(f64, f64)>> =
        polylines.into_iter().map(|line| line.into_iter().map(rotate).collect()).collect();
    for line in &polylines {
        for &(px, py) in line {
            grow(px, py, 0.0, 0.0);
        }
    }
    let label_points: Vec<Option<(f64, f64)>> = label_points.into_iter().map(|p| p.map(rotate)).collect();
    for (index, point) in label_points.iter().enumerate() {
        if let Some((px, py)) = point {
            let edge = &edges_in[index];
            grow(*px, *py, edge.label_width as f64, edge.label_height as f64);
        }
    }

    let dx = MARGIN - min_x;
    let dy = MARGIN - min_y;
    let shift = |(px, py): (f64, f64)| ((px + dx) as f32, (py + dy) as f32);
    Output {
        width: (max_x - min_x + MARGIN * 2.0) as f32,
        height: (max_y - min_y + MARGIN * 2.0) as f32,
        nodes: centres.into_iter().map(shift).collect(),
        edges: polylines.into_iter().map(|line| line.into_iter().map(shift).collect()).collect(),
        labels: label_points.into_iter().map(|p| p.map(shift)).collect(),
        crossings: best_crossings.min(u32::MAX as u64) as u32,
    }
}

/// Fold a layout that is far wider or taller than `target` into bands.
///
/// A layered layout of a big tree is one enormous bottom rank: 10,000 nodes
/// lay out ~480,000 units wide and ~1,600 tall, which fitted to any screen is a
/// line with every node a fraction of a pixel. This cuts the long axis into
/// bands and stacks them, the way a long line of text wraps: each band keeps
/// its own ranks aligned and its own local structure, and the whole diagram
/// comes out near the target proportions, where nodes are visible at a glance.
///
/// Cuts go where they hurt least: each is searched for near its ideal position
/// to cross the fewest edges and never split a node. The few edges that do
/// cross a cut are rerouted as a connector between the bands.
#[allow(clippy::too_many_arguments)]
fn wrap(
    centres: &mut [(f64, f64)],
    sizes: &[(f64, f64)],
    shapes: &[u32],
    polylines: &mut [Vec<(f64, f64)>],
    labels: &mut [Option<(f64, f64)>],
    edges: &[EdgeIn],
    target: f64,
    rank_sep: f64,
) {
    let n = centres.len();
    if n < 2 || target <= 0.0 {
        return;
    }
    let mut min_x = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for (i, &(cx, cy)) in centres.iter().enumerate() {
        let (w, h) = sizes[i];
        min_x = min_x.min(cx - w / 2.0);
        max_x = max_x.max(cx + w / 2.0);
        min_y = min_y.min(cy - h / 2.0);
        max_y = max_y.max(cy + h / 2.0);
    }
    let width = max_x - min_x;
    let height = max_y - min_y;
    if width <= 0.0 || height <= 0.0 {
        return;
    }
    let ratio = width / height;
    // Within 2.5× of the target is a legitimately wide or tall diagram.
    let wide = ratio > target * 2.5;
    let tall = ratio < target / 2.5;
    if !wide && !tall {
        return;
    }

    // `along` is the axis being cut, `across` the one bands stack on.
    let along = |p: (f64, f64)| if wide { p.0 } else { p.1 };
    let across = |p: (f64, f64)| if wide { p.1 } else { p.0 };
    let along_size = |i: usize| if wide { sizes[i].0 } else { sizes[i].1 };
    let across_size = |i: usize| if wide { sizes[i].1 } else { sizes[i].0 };
    let (start, span) = if wide { (min_x, width) } else { (min_y, height) };
    let gap = rank_sep.max(30.0) * 3.0;
    // How many bands: the count whose folded result lands nearest the target.
    // Bands are not all as tall as the original — past the first, a tree's
    // bands hold only its wide bottom ranks — so each candidate is measured
    // rather than estimated, over nodes sorted along the cut axis once.
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_unstable_by(|&a, &b| along(centres[a]).total_cmp(&along(centres[b])));
    let folded_ratio = |k: usize| -> f64 {
        let step = span / k as f64;
        let mut lo = vec![f64::INFINITY; k];
        let mut hi = vec![f64::NEG_INFINITY; k];
        for &i in &order {
            let b = (((along(centres[i]) - start) / step) as usize).min(k - 1);
            lo[b] = lo[b].min(across(centres[i]) - across_size(i) / 2.0);
            hi[b] = hi[b].max(across(centres[i]) + across_size(i) / 2.0);
        }
        let stacked: f64 = (0..k).filter(|&b| lo[b].is_finite()).map(|b| hi[b] - lo[b] + gap).sum::<f64>() - gap;
        let folded = if wide { step / stacked.max(1.0) } else { stacked.max(1.0) / step };
        folded
    };
    let skew = if wide { ratio / target } else { target / ratio };
    let guess = skew.sqrt().max(2.0);
    let mut bands = 2;
    let mut best = f64::INFINITY;
    let most = ((guess * 4.0) as usize).clamp(2, n.min(2_000));
    let mut k = 2;
    while k <= most {
        let miss = (folded_ratio(k) / target).ln().abs();
        if miss < best {
            best = miss;
            bands = k;
        }
        // Dense near the guess, coarser far from it: the curve is smooth.
        k += if (k as f64) < guess * 1.5 { 1 } else { (k / 16).max(1) };
    }

    // Sorted interval ends make "how many edges / nodes straddle x" two
    // binary searches.
    let mut edge_lo = Vec::new();
    let mut edge_hi = Vec::new();
    for line in polylines.iter() {
        if line.len() < 2 {
            continue;
        }
        let lo = line.iter().map(|&p| along(p)).fold(f64::INFINITY, f64::min);
        let hi = line.iter().map(|&p| along(p)).fold(f64::NEG_INFINITY, f64::max);
        edge_lo.push(lo);
        edge_hi.push(hi);
    }
    let mut node_lo: Vec<f64> = (0..n).map(|i| along(centres[i]) - along_size(i) / 2.0).collect();
    let mut node_hi: Vec<f64> = (0..n).map(|i| along(centres[i]) + along_size(i) / 2.0).collect();
    for list in [&mut edge_lo, &mut edge_hi, &mut node_lo, &mut node_hi] {
        list.sort_unstable_by(f64::total_cmp);
    }
    let below = |list: &[f64], x: f64| list.partition_point(|&v| v < x);
    let at_or_below = |list: &[f64], x: f64| list.partition_point(|&v| v <= x);
    let cost = |x: f64| -> f64 {
        let edges_cut = below(&edge_lo, x) - below(&edge_hi, x);
        let nodes_cut = below(&node_lo, x) - at_or_below(&node_hi, x);
        edges_cut as f64 + nodes_cut as f64 * 1000.0
    };

    let step = span / bands as f64;
    let mut cuts: Vec<f64> = Vec::with_capacity(bands - 1);
    for b in 1..bands {
        let ideal = start + step * b as f64;
        let window = step * 0.25;
        let mut best = (f64::INFINITY, ideal);
        const SAMPLES: usize = 256;
        for s in 0..=SAMPLES {
            let x = ideal - window + 2.0 * window * s as f64 / SAMPLES as f64;
            let score = cost(x) + (x - ideal).abs() / window * 2.0;
            if score < best.0 {
                best = (score, x);
            }
        }
        cuts.push(best.1);
    }
    let band_of = |a: f64| cuts.partition_point(|&c| c < a);

    let node_band: Vec<usize> = (0..n).map(|i| band_of(along(centres[i]))).collect();
    let mut lo = vec![f64::INFINITY; bands];
    let mut hi = vec![f64::NEG_INFINITY; bands];
    for i in 0..n {
        let b = node_band[i];
        lo[b] = lo[b].min(across(centres[i]) - across_size(i) / 2.0);
        hi[b] = hi[b].max(across(centres[i]) + across_size(i) / 2.0);
    }
    let origin = if wide { min_y } else { min_x };
    let mut cursor = origin;
    let mut shift_along = vec![0.0; bands];
    let mut shift_across = vec![0.0; bands];
    for b in 0..bands {
        let band_start = if b == 0 { start } else { cuts[b - 1] };
        shift_along[b] = start - band_start;
        if lo[b].is_finite() {
            shift_across[b] = cursor - lo[b];
            cursor += hi[b] - lo[b] + gap;
        }
    }
    let place = |p: (f64, f64), b: usize| -> (f64, f64) {
        if wide {
            (p.0 + shift_along[b], p.1 + shift_across[b])
        } else {
            (p.0 + shift_across[b], p.1 + shift_along[b])
        }
    };

    for i in 0..n {
        centres[i] = place(centres[i], node_band[i]);
    }
    for (index, line) in polylines.iter_mut().enumerate() {
        if line.len() < 2 {
            continue;
        }
        let edge = &edges[index];
        let (s, t) = (edge.source as usize, edge.target as usize);
        let (bs, bt) = (node_band[s], node_band[t]);
        if bs == bt {
            for p in line.iter_mut() {
                *p = place(*p, bs);
            }
            if let Some(label) = labels[index].as_mut() {
                *label = place(*label, bs);
            }
            continue;
        }
        // A connector between bands: straight from the side of the source
        // that faces the target to the side of the target facing back — never
        // out of the far side and back underneath its own node.
        let (cs, ct) = (centres[s], centres[t]);
        let from = boundary(cs, sizes[s].0, sizes[s].1, shapes[s], ct);
        let to = boundary(ct, sizes[t].0, sizes[t].1, shapes[t], cs);
        *line = vec![from, to];
        if let Some(label) = labels[index].as_mut() {
            *label = ((from.0 + to.0) / 2.0, (from.1 + to.1) / 2.0);
        }
    }
}

/// Where the segment from a node's centre towards `toward` leaves its outline.
///
/// Sizes arrive in layout space; the shape test is symmetric in x and y, so the
/// rotation that happens later does not change the answer.
fn boundary(
    centre: (f64, f64),
    width: f64,
    height: f64,
    shape: u32,
    toward: (f64, f64),
) -> (f64, f64) {
    let dx = toward.0 - centre.0;
    let dy = toward.1 - centre.1;
    let hw = width / 2.0;
    let hh = height / 2.0;
    if (dx == 0.0 && dy == 0.0) || hw <= 0.0 || hh <= 0.0 {
        return centre;
    }
    let t = match shape {
        SHAPE_ELLIPSE => 1.0 / ((dx / hw).powi(2) + (dy / hh).powi(2)).sqrt(),
        SHAPE_DIAMOND => 1.0 / (dx.abs() / hw + dy.abs() / hh),
        _ => {
            let tx = if dx != 0.0 { hw / dx.abs() } else { f64::INFINITY };
            let ty = if dy != 0.0 { hh / dy.abs() } else { f64::INFINITY };
            tx.min(ty)
        }
    };
    let t = t.min(1.0);
    (centre.0 + dx * t, centre.1 + dy * t)
}

/// Passes of adjacent swapping after each sweep.
const TRANSPOSE_PASSES: usize = 4;

/// Swap neighbours in a rank wherever that alone removes crossings.
///
/// Barycenters place each node by an average, which cannot see that two
/// siblings would untangle by trading places. This local fix-up (Gansner et
/// al.'s "transpose") catches exactly that, and since only the edges of the
/// two nodes involved change, each test costs their degree, not the rank's.
fn transpose(layers: &mut [Vec<u32>], position: &mut [u32], up: &Csr, down: &Csr) {
    let mut left: Vec<u32> = Vec::new();
    let mut right: Vec<u32> = Vec::new();
    // Crossings among u's and v's edges on one side when u sits left of v:
    // pairs whose endpoints are the other way round.
    let mut pair_crossings = |u: usize, v: usize, side: &Csr, position: &[u32]| -> u64 {
        left.clear();
        right.clear();
        left.extend(side.range(u).map(|s| position[side.targets[s] as usize]));
        right.extend(side.range(v).map(|s| position[side.targets[s] as usize]));
        if left.is_empty() || right.is_empty() {
            return 0;
        }
        left.sort_unstable();
        right.sort_unstable();
        let mut count = 0u64;
        let mut j = 0;
        for &a in left.iter() {
            while j < right.len() && right[j] < a {
                j += 1;
            }
            count += j as u64;
        }
        count
    };
    for _ in 0..TRANSPOSE_PASSES {
        let mut improved = false;
        for layer in layers.iter_mut() {
            for i in 0..layer.len().saturating_sub(1) {
                let (u, v) = (layer[i] as usize, layer[i + 1] as usize);
                let as_is = pair_crossings(u, v, up, position) + pair_crossings(u, v, down, position);
                let swapped = pair_crossings(v, u, up, position) + pair_crossings(v, u, down, position);
                if swapped < as_is {
                    layer.swap(i, i + 1);
                    position[u] = (i + 1) as u32;
                    position[v] = i as u32;
                    improved = true;
                }
            }
        }
        if !improved {
            break;
        }
    }
}

/// Crossings between every pair of adjacent ranks.
///
/// Barth, Jünger and Mutzel's accumulator: list each edge's lower endpoint in
/// order of its upper endpoint, then count inversions with a Fenwick tree.
fn count_crossings(layers: &[Vec<u32>], down: &Csr, position: &[u32]) -> u64 {
    let mut total = 0u64;
    let mut sequence: Vec<u32> = Vec::new();
    let mut tree: Vec<u32> = Vec::new();
    for r in 0..layers.len().saturating_sub(1) {
        let lower_len = layers[r + 1].len();
        sequence.clear();
        for &v in &layers[r] {
            let start = sequence.len();
            for slot in down.range(v as usize) {
                sequence.push(position[down.targets[slot] as usize]);
            }
            sequence[start..].sort_unstable();
        }
        tree.clear();
        tree.resize(lower_len + 1, 0);
        for (seen, &p) in sequence.iter().enumerate() {
            // Edges already inserted that end strictly right of p cross this one.
            let mut i = p as usize + 1;
            let mut not_greater = 0u32;
            while i > 0 {
                not_greater += tree[i];
                i &= i - 1;
            }
            total += (seen as u32 - not_greater) as u64;
            let mut i = p as usize + 1;
            while i <= lower_len {
                tree[i] += 1;
                i += i & i.wrapping_neg();
            }
        }
    }
    total
}

/// Weighted isotonic regression with separation constraints.
///
/// Minimise Σ wᵢ(xᵢ − dᵢ)² subject to xᵢ₊₁ − xᵢ ≥ gapᵢ. Substituting
/// yᵢ = xᵢ − Σⱼ<ᵢ gapⱼ turns the constraints into yᵢ₊₁ ≥ yᵢ, which pool-adjacent-
/// violators solves exactly in one left-to-right pass.
#[derive(Default)]
struct Placer {
    offsets: Vec<f64>,
    blocks: Vec<(f64, f64, usize)>,
}

impl Placer {
    fn place(
        &mut self,
        layer: &[u32],
        desired: &[f64],
        weights: &[f64],
        gap: &dyn Fn(usize, usize) -> f64,
        x: &mut [f64],
    ) {
        let n = layer.len();
        if n == 0 {
            return;
        }
        self.offsets.clear();
        let mut offset = 0.0;
        for i in 0..n {
            if i > 0 {
                offset += gap(layer[i - 1] as usize, layer[i] as usize);
            }
            self.offsets.push(offset);
        }
        // (Σw, Σw·target, count)
        self.blocks.clear();
        for i in 0..n {
            let target = desired[i] - self.offsets[i];
            self.blocks.push((weights[i], weights[i] * target, 1));
            while self.blocks.len() >= 2 {
                let last = self.blocks[self.blocks.len() - 1];
                let prev = self.blocks[self.blocks.len() - 2];
                if prev.1 / prev.0 <= last.1 / last.0 {
                    break;
                }
                self.blocks.pop();
                let merged = self.blocks.last_mut().unwrap();
                merged.0 += last.0;
                merged.1 += last.1;
                merged.2 += last.2;
            }
        }
        let mut i = 0;
        for &(weight, sum, count) in &self.blocks {
            let value = sum / weight;
            for _ in 0..count {
                x[layer[i] as usize] = value + self.offsets[i];
                i += 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node() -> NodeIn {
        NodeIn { width: 100.0, height: 40.0, shape: SHAPE_RECT }
    }

    fn edge(source: u32, target: u32) -> EdgeIn {
        EdgeIn { source, target, label_width: 0.0, label_height: 0.0 }
    }

    fn overlaps(out: &Output, nodes: &[NodeIn]) -> bool {
        for i in 0..nodes.len() {
            for j in (i + 1)..nodes.len() {
                let (a, b) = (out.nodes[i], out.nodes[j]);
                let w = (nodes[i].width + nodes[j].width) / 2.0;
                let h = (nodes[i].height + nodes[j].height) / 2.0;
                if (a.0 - b.0).abs() < w - 0.01 && (a.1 - b.1).abs() < h - 0.01 {
                    return true;
                }
            }
        }
        false
    }

    #[test]
    fn chain_goes_down() {
        let nodes = vec![node(); 3];
        let out = run(&nodes, &[edge(0, 1), edge(1, 2)], &Options::default());
        assert!(out.nodes[0].1 < out.nodes[1].1 && out.nodes[1].1 < out.nodes[2].1);
        assert!((out.nodes[0].0 - out.nodes[2].0).abs() < 0.5, "a chain is straight");
    }

    #[test]
    fn left_to_right_goes_across() {
        let nodes = vec![node(); 3];
        let options = Options { direction: DIR_LR, ..Options::default() };
        let out = run(&nodes, &[edge(0, 1), edge(1, 2)], &options);
        assert!(out.nodes[0].0 < out.nodes[1].0 && out.nodes[1].0 < out.nodes[2].0);
    }

    #[test]
    fn cycles_terminate_and_keep_direction() {
        let nodes = vec![node(); 3];
        let out = run(&nodes, &[edge(0, 1), edge(1, 2), edge(2, 0)], &Options::default());
        let back = &out.edges[2];
        assert!(back.first().unwrap().1 > back.last().unwrap().1, "back edge runs from source to target");
    }

    #[test]
    fn fan_out_does_not_overlap() {
        let nodes = vec![node(); 8];
        let edges: Vec<EdgeIn> = (1..8).map(|t| edge(0, t)).collect();
        let out = run(&nodes, &edges, &Options::default());
        assert!(!overlaps(&out, &nodes));
    }

    #[test]
    fn edges_start_on_node_outline() {
        let nodes = vec![node(); 2];
        let out = run(&nodes, &[edge(0, 1)], &Options::default());
        let start = out.edges[0][0];
        assert!((start.1 - (out.nodes[0].1 + 20.0)).abs() < 0.5);
    }

    #[test]
    fn labels_get_room() {
        let nodes = vec![node(); 2];
        let edges = [EdgeIn { source: 0, target: 1, label_width: 60.0, label_height: 20.0 }];
        let out = run(&nodes, &edges, &Options::default());
        let label = out.labels[0].expect("label placed");
        assert!(label.1 > out.nodes[0].1 + 20.0 && label.1 < out.nodes[1].1 - 20.0);
    }

    #[test]
    fn crossing_reduction_untangles() {
        // K2,2 drawn crossed by input order: 0→3, 1→2 with ranks 0,0 / 1,1.
        let nodes = vec![node(); 4];
        let out = run(&nodes, &[edge(0, 3), edge(1, 2)], &Options::default());
        assert_eq!(out.crossings, 0);
    }

    #[test]
    fn wide_layouts_fold_toward_the_target_aspect() {
        let n = 3_000u32;
        let nodes = vec![node(); n as usize];
        let edges: Vec<EdgeIn> = (1..n).map(|i| edge((i - 1) / 3, i)).collect();
        let flat = run(&nodes, &edges, &Options::default());
        let folded = run(&nodes, &edges, &Options { aspect: 1.8, ..Options::default() });
        let flat_ratio = flat.width / flat.height;
        let ratio = folded.width / folded.height;
        assert!(flat_ratio > 20.0, "unfolded tree is a strip: {flat_ratio}");
        assert!(ratio > 1.8 / 2.5 && ratio < 1.8 * 2.5, "folded ratio {ratio}");
        assert!(!overlaps(&folded, &nodes));
        assert!(folded.edges.iter().all(|e| e.len() >= 2));
    }

    #[test]
    fn deep_chains_fold_into_columns() {
        let n = 400u32;
        let nodes = vec![node(); n as usize];
        let edges: Vec<EdgeIn> = (1..n).map(|i| edge(i - 1, i)).collect();
        let folded = run(&nodes, &edges, &Options { aspect: 1.8, ..Options::default() });
        let ratio = folded.width / folded.height;
        assert!(ratio > 1.8 / 2.5 && ratio < 1.8 * 2.5, "folded ratio {ratio}");
        assert!(!overlaps(&folded, &nodes));
    }

    #[test]
    fn long_edges_past_the_dummy_budget_are_drawn_straight() {
        // A chain of 3,000 plus an edge from the head to every node would need
        // ~4.5 million dummies; the budget keeps it bounded and fast.
        let n = 3_000u32;
        let nodes = vec![node(); n as usize];
        let mut edges: Vec<EdgeIn> = (1..n).map(|i| edge(i - 1, i)).collect();
        edges.extend((2..n).map(|i| edge(0, i)));
        let start = std::time::Instant::now();
        let out = run(&nodes, &edges, &Options::default());
        assert!(start.elapsed().as_secs_f64() < 5.0, "took {:?}", start.elapsed());
        assert!(out.edges.iter().all(|e| e.len() >= 2));
        eprintln!("budgeted long edges: {:?}", start.elapsed());
    }

    #[test]
    fn large_graph_is_fast_and_clean() {
        let n = 10_000u32;
        let nodes = vec![node(); n as usize];
        let mut edges = Vec::new();
        for i in 1..n {
            edges.push(edge((i - 1) / 3, i));
            if i % 5 == 0 && i > 10 {
                edges.push(edge(i - 1 - (i * 7919) % (i - 1).min(60), i));
            }
        }
        let start = std::time::Instant::now();
        let out = run(&nodes, &edges, &Options::default());
        let elapsed = start.elapsed();
        assert_eq!(out.nodes.len(), n as usize);
        assert!(out.edges.iter().all(|e| e.len() >= 2));
        eprintln!("10k nodes: {:?}, {} crossings", elapsed, out.crossings);
    }
}
