//! WebAssembly entry points for the layered layout.
//!
//! The boundary is two flat arrays of 32-bit words rather than wasm-bindgen
//! objects: JavaScript writes the whole graph into linear memory once, calls
//! `layout` once, and reads the whole result back once. At 10,000 nodes that is
//! three copies of a few hundred kilobytes instead of tens of thousands of
//! boundary crossings, and the build needs nothing beyond `cargo`.
//!
//! Input words (floats are f32 bit patterns):
//!   [0] node count n   [1] edge count m   [2] direction   [3] target aspect (f32, 0 = off)
//!   [4] node_sep       [5] rank_sep       [6] edge_sep    [7] reserved
//!   n × (width, height, shape)
//!   m × (source, target, label_width, label_height)
//!
//! Output words:
//!   [0] total point count P   [1] width   [2] height   [3] crossings
//!   n × (x, y)                 node centres
//!   (m + 1) × offset           edge e's points are [offset[e], offset[e + 1])
//!   m × (x, y)                 label centres, NaN when the edge has no label
//!   P × (x, y)                 edge points

pub mod class;
pub mod er;
pub mod layout;
pub mod parser;

use layout::{EdgeIn, NodeIn, Options};
use std::sync::atomic::{AtomicUsize, Ordering};

static RESULT_LEN: AtomicUsize = AtomicUsize::new(0);

/// Allocate `n` zeroed words for the caller to fill.
#[no_mangle]
pub extern "C" fn alloc_words(n: usize) -> *mut u32 {
    Box::into_raw(vec![0u32; n].into_boxed_slice()) as *mut u32
}

/// Release words from `alloc_words` or `layout`.
///
/// # Safety
/// `ptr` and `n` must be exactly a pointer and length this module handed out.
#[no_mangle]
pub unsafe extern "C" fn free_words(ptr: *mut u32, n: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, n)));
}

/// Word count of the most recent `layout` result.
#[no_mangle]
pub extern "C" fn result_len() -> usize {
    RESULT_LEN.load(Ordering::Relaxed)
}

/// Lay out the graph encoded at `ptr`; returns the encoded result.
///
/// # Safety
/// `ptr` must point to `len` initialised words in the format above.
#[no_mangle]
pub unsafe extern "C" fn layout(ptr: *const u32, len: usize) -> *mut u32 {
    let words = std::slice::from_raw_parts(ptr, len);
    let result = encode(&decode(words));
    RESULT_LEN.store(result.len(), Ordering::Relaxed);
    Box::into_raw(result.into_boxed_slice()) as *mut u32
}

/// Parse Mermaid flowchart source (`len` UTF-8 bytes at `ptr`).
///
/// Output words:
///   [0] status: 0 parsed, anything else declined (ask Mermaid)
///   [1] direction   [2] node count n   [3] edge count m   [4] style span count S
///   n × (id start, id end, label start, label end, shape)   label start = u32::MAX if none
///   (n + 1) × style offset     node i's styles are spans [offset[i], offset[i + 1])
///   S × (start, end)           style declarations, lowest precedence first
///   m × (source, target, label start, label end, stroke, end head, start head)
///
/// Spans are byte offsets into the input.
///
/// # Safety
/// `ptr` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn parse_flowchart(ptr: *const u8, len: usize) -> *mut u32 {
    let bytes = std::slice::from_raw_parts(ptr, len);
    let result = encode_parsed(parser::parse(bytes));
    RESULT_LEN.store(result.len(), Ordering::Relaxed);
    Box::into_raw(result.into_boxed_slice()) as *mut u32
}

fn encode_parsed(parsed: Result<parser::Parsed, parser::Decline>) -> Vec<u32> {
    let parsed = match parsed {
        Ok(parsed) => parsed,
        Err(reason) => return vec![reason as u32, 0, 0, 0, 0],
    };
    const NONE: u32 = u32::MAX;
    let spans: usize = parsed.nodes.iter().map(|n| n.resolved.len()).sum();
    let n = parsed.nodes.len();
    let m = parsed.edges.len();
    let mut words = Vec::with_capacity(5 + n * 5 + n + 1 + spans * 2 + m * 7);
    words.extend([0, parsed.direction, n as u32, m as u32, spans as u32]);
    for node in &parsed.nodes {
        let id = node.id.expect("every vertex has an id");
        let (ls, le) = node.label.map_or((NONE, NONE), |l| (l.start, l.end));
        words.extend([id.start, id.end, ls, le, node.shape]);
    }
    let mut offset = 0u32;
    for node in &parsed.nodes {
        words.push(offset);
        offset += node.resolved.len() as u32;
    }
    words.push(offset);
    for node in &parsed.nodes {
        for span in &node.resolved {
            words.extend([span.start, span.end]);
        }
    }
    for edge in &parsed.edges {
        let (ls, le) = edge.label.map_or((NONE, NONE), |l| (l.start, l.end));
        words.extend([edge.source, edge.target, ls, le, edge.stroke, edge.end, edge.start]);
    }
    words
}

/// Parse Mermaid `erDiagram` source (`len` UTF-8 bytes at `ptr`).
///
/// Output words:
///   [0] status: 0 parsed, anything else declined (ask Mermaid)
///   [1] direction   [2] entity count n   [3] relationship count m   [4] attribute count R
///   n × (name start, name end, alias start, alias end, 0)     alias = u32::MAX if none
///   (n + 1) × attribute offset
///   R × (type, name, keys, comment) as start/end pairs       u32::MAX if absent
///   m × (entity a, entity b, label start, label end, card a, card b, identifying)
///
/// # Safety
/// `ptr` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn parse_er(ptr: *const u8, len: usize) -> *mut u32 {
    let bytes = std::slice::from_raw_parts(ptr, len);
    let result = encode_er(er::parse(bytes));
    RESULT_LEN.store(result.len(), Ordering::Relaxed);
    Box::into_raw(result.into_boxed_slice()) as *mut u32
}

fn encode_er(parsed: Result<er::ErParsed, parser::Decline>) -> Vec<u32> {
    const NONE: u32 = u32::MAX;
    let parsed = match parsed {
        Ok(parsed) => parsed,
        Err(reason) => return vec![reason as u32, 0, 0, 0, 0],
    };
    let pair = |span: Option<parser::Span>| span.map_or([NONE, NONE], |s| [s.start, s.end]);
    let attributes: usize = parsed.entities.iter().map(|e| e.attributes.len()).sum();
    let mut words = vec![
        0,
        parsed.direction,
        parsed.entities.len() as u32,
        parsed.relationships.len() as u32,
        attributes as u32,
    ];
    for entity in &parsed.entities {
        let [alias_start, alias_end] = pair(entity.alias);
        words.extend([entity.name.start, entity.name.end, alias_start, alias_end, 0]);
    }
    let mut offset = 0u32;
    for entity in &parsed.entities {
        words.push(offset);
        offset += entity.attributes.len() as u32;
    }
    words.push(offset);
    for entity in &parsed.entities {
        for a in &entity.attributes {
            words.extend(pair(Some(a.kind)));
            words.extend(pair(Some(a.name)));
            words.extend(pair(a.keys));
            words.extend(pair(a.comment));
        }
    }
    for r in &parsed.relationships {
        let [label_start, label_end] = pair(r.label);
        words.extend([r.a, r.b, label_start, label_end, r.card_a, r.card_b, r.identifying as u32]);
    }
    words
}

/// Parse Mermaid `classDiagram` source (`len` UTF-8 bytes at `ptr`).
///
/// Output words:
///   [0] status: 0 parsed, anything else declined (ask Mermaid)
///   [1] direction   [2] class count n   [3] relation count m   [4] member count M
///   n × (name start, name end)
///   (n + 1) × member offset
///   M × (start, end)        raw member lines, annotations included
///   m × (class a, class b, label start, label end, start type, end type, dashed)
///
/// # Safety
/// `ptr` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn parse_class(ptr: *const u8, len: usize) -> *mut u32 {
    let bytes = std::slice::from_raw_parts(ptr, len);
    let result = encode_class(class::parse(bytes));
    RESULT_LEN.store(result.len(), Ordering::Relaxed);
    Box::into_raw(result.into_boxed_slice()) as *mut u32
}

fn encode_class(parsed: Result<class::ClassParsed, parser::Decline>) -> Vec<u32> {
    const NONE: u32 = u32::MAX;
    let parsed = match parsed {
        Ok(parsed) => parsed,
        Err(reason) => return vec![reason as u32, 0, 0, 0, 0],
    };
    let members: usize = parsed.classes.iter().map(|c| c.members.len()).sum();
    let mut words = vec![
        0,
        parsed.direction,
        parsed.classes.len() as u32,
        parsed.relations.len() as u32,
        members as u32,
    ];
    for class in &parsed.classes {
        words.extend([class.name.start, class.name.end]);
    }
    let mut offset = 0u32;
    for class in &parsed.classes {
        words.push(offset);
        offset += class.members.len() as u32;
    }
    words.push(offset);
    for class in &parsed.classes {
        for member in &class.members {
            words.extend([member.start, member.end]);
        }
    }
    for r in &parsed.relations {
        let (label_start, label_end) = r.label.map_or((NONE, NONE), |l| (l.start, l.end));
        words.extend([r.a, r.b, label_start, label_end, r.start, r.end, r.dashed as u32]);
    }
    words
}

struct Decoded {
    nodes: Vec<NodeIn>,
    edges: Vec<EdgeIn>,
    options: Options,
}

fn decode(words: &[u32]) -> Decoded {
    let f = |i: usize| f32::from_bits(words[i]);
    let n = words[0] as usize;
    let m = words[1] as usize;
    let options = Options { direction: words[2], node_sep: f(4), rank_sep: f(5), edge_sep: f(6), aspect: f(3) };
    let mut cursor = 8;
    let mut nodes = Vec::with_capacity(n);
    for _ in 0..n {
        nodes.push(NodeIn { width: f(cursor), height: f(cursor + 1), shape: words[cursor + 2] });
        cursor += 3;
    }
    let mut edges = Vec::with_capacity(m);
    for _ in 0..m {
        edges.push(EdgeIn {
            source: words[cursor],
            target: words[cursor + 1],
            label_width: f(cursor + 2),
            label_height: f(cursor + 3),
        });
        cursor += 4;
    }
    Decoded { nodes, edges, options }
}

fn encode(input: &Decoded) -> Vec<u32> {
    let out = layout::run(&input.nodes, &input.edges, &input.options);
    let total_points: usize = out.edges.iter().map(Vec::len).sum();
    let n = out.nodes.len();
    let m = out.edges.len();
    let mut words = Vec::with_capacity(4 + n * 2 + (m + 1) + m * 2 + total_points * 2);
    words.push(total_points as u32);
    words.push(out.width.to_bits());
    words.push(out.height.to_bits());
    words.push(out.crossings);
    for &(x, y) in &out.nodes {
        words.push(x.to_bits());
        words.push(y.to_bits());
    }
    let mut offset = 0u32;
    for line in &out.edges {
        words.push(offset);
        offset += line.len() as u32;
    }
    words.push(offset);
    for label in &out.labels {
        let (x, y) = label.unwrap_or((f32::NAN, f32::NAN));
        words.push(x.to_bits());
        words.push(y.to_bits());
    }
    for line in &out.edges {
        for &(x, y) in line {
            words.push(x.to_bits());
            words.push(y.to_bits());
        }
    }
    words
}
