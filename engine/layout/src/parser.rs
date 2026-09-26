//! A fast path for Mermaid's flowchart syntax.
//!
//! Mermaid's own parser (a jison grammar feeding a database that sanitises
//! every label through DOMPurify) takes ~1.3s on a 10,000-node flowchart —
//! most of the time to first picture once layout is WebAssembly. This scanner
//! covers the syntax large generated flowcharts actually use in a single pass
//! over the bytes, ~100× faster.
//!
//! It is deliberately a *subset*, and a strict one. Anything it does not fully
//! understand — subgraphs, `@{…}` shape data, edge ids, `direction`, unusual
//! characters in ids, a malformed link — makes it decline (`Err`) rather than
//! guess, and the caller falls back to Mermaid's parser. So it can never
//! disagree with Mermaid about a diagram; at worst it declines to be fast. The
//! token rules below mirror Mermaid's lexer (flow.jison):
//!
//!   links   [xo<]?--+[-xo>]   [xo<]?==+[=xo>]   [xo<]?-?\.+-[xo>]?   ~~~+
//!   labels  A -- text --> B   A == text ==> B   A -. text .-> B   A -->|text| B
//!   ids     [A-Za-z0-9_] and non-ASCII, plus `-` when not starting a link
//!
//! Labels are returned as byte spans into the source; the caller decodes them
//! and applies the same text clean-up as for Mermaid's output.

use std::collections::HashMap;

pub const STROKE_NORMAL: u32 = 0;
pub const STROKE_THICK: u32 = 1;
pub const STROKE_DOTTED: u32 = 2;
pub const STROKE_INVISIBLE: u32 = 3;

pub const HEAD_NONE: u32 = 0;
pub const HEAD_POINT: u32 = 1;
pub const HEAD_CROSS: u32 = 2;
pub const HEAD_CIRCLE: u32 = 3;

/// Mermaid's vertex type names, by the code this parser reports. Code 0 is a
/// node referenced without a shape.
pub const SHAPES: [&str; 15] = [
    "",
    "square",
    "round",
    "stadium",
    "subroutine",
    "cylinder",
    "circle",
    "doublecircle",
    "ellipse",
    "odd",
    "diamond",
    "hexagon",
    "lean_right",
    "lean_left",
    "trapezoid",
];
const SHAPE_INV_TRAPEZOID: u32 = 15;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Span {
    pub start: u32,
    pub end: u32,
}

#[derive(Debug, Default)]
pub struct Node {
    pub id: Option<Span>,
    pub label: Option<Span>,
    pub shape: u32,
    classes: Vec<Span>,
    styles: Vec<Span>,
    /// Resolved after parsing: class styles in order, then the node's own.
    pub resolved: Vec<Span>,
}

#[derive(Debug)]
pub struct Edge {
    pub source: u32,
    pub target: u32,
    pub label: Option<Span>,
    pub stroke: u32,
    pub end: u32,
    pub start: u32,
}

#[derive(Debug, Default)]
pub struct Parsed {
    /// 0 TB, 1 BT, 2 LR, 3 RL — the layout's codes.
    pub direction: u32,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

/// Why the fast path declined. Only for diagnostics; any value means "ask Mermaid".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decline {
    NoHeader = 1,
    Unsupported = 2,
    Syntax = 3,
}

type Result<T> = std::result::Result<T, Decline>;

struct Parser<'a> {
    s: &'a [u8],
    i: usize,
    nodes: Vec<Node>,
    index: HashMap<&'a [u8], u32>,
    edges: Vec<Edge>,
    class_defs: HashMap<&'a [u8], Vec<Span>>,
}

#[inline]
fn is_id_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b >= 0x80
}

#[inline]
fn is_inline_space(b: u8) -> bool {
    b == b' ' || b == b'\t' || b == b'\r'
}

pub fn parse(source: &[u8]) -> std::result::Result<Parsed, Decline> {
    let mut parser = Parser {
        s: source,
        i: 0,
        nodes: Vec::new(),
        index: HashMap::new(),
        edges: Vec::new(),
        class_defs: HashMap::new(),
    };
    let direction = parser.header()?;
    parser.statements()?;
    parser.resolve_styles();
    Ok(Parsed { direction, nodes: parser.nodes, edges: parser.edges })
}

impl<'a> Parser<'a> {
    fn peek(&self, offset: usize) -> u8 {
        *self.s.get(self.i + offset).unwrap_or(&0)
    }

    fn at_end(&self) -> bool {
        self.i >= self.s.len()
    }

    fn starts_with(&self, text: &[u8]) -> bool {
        self.s[self.i..].starts_with(text)
    }

    fn span(&self, start: usize, end: usize) -> Span {
        Span { start: start as u32, end: end as u32 }
    }

    fn skip_inline_space(&mut self) {
        while !self.at_end() && is_inline_space(self.s[self.i]) {
            self.i += 1;
        }
    }

    fn skip_line(&mut self) {
        while !self.at_end() && self.s[self.i] != b'\n' {
            self.i += 1;
        }
    }

    /// Trim spaces from both ends of a span.
    fn trimmed(&self, mut start: usize, mut end: usize) -> Span {
        while start < end && self.s[start].is_ascii_whitespace() {
            start += 1;
        }
        while end > start && self.s[end - 1].is_ascii_whitespace() {
            end -= 1;
        }
        self.span(start, end)
    }

    /// Front matter, blank lines and comments, then `flowchart|graph [DIR]`.
    fn header(&mut self) -> Result<u32> {
        if self.s.starts_with(&[0xEF, 0xBB, 0xBF]) {
            self.i = 3;
        }
        let mut in_front_matter = false;
        loop {
            if self.at_end() {
                return Err(Decline::NoHeader);
            }
            let line_start = self.i;
            self.skip_line();
            let line = self.trimmed(line_start, self.i);
            let text = &self.s[line.start as usize..line.end as usize];
            if !self.at_end() {
                self.i += 1;
            }
            if text == b"---" {
                in_front_matter = !in_front_matter;
                continue;
            }
            if in_front_matter || text.is_empty() || text.starts_with(b"%%") {
                continue;
            }
            // Re-scan the header line itself.
            self.i = line.start as usize;
            let keyword = if self.starts_with(b"flowchart") {
                9
            } else if self.starts_with(b"graph") {
                5
            } else {
                return Err(Decline::NoHeader);
            };
            self.i += keyword;
            if is_id_byte(self.peek(0)) || self.peek(0) == b'-' {
                return Err(Decline::Unsupported); // flowchart-elk and friends
            }
            self.skip_inline_space();
            let mut direction = 0;
            for (token, code) in [(b"TB", 0), (b"TD", 0), (b"BT", 1), (b"LR", 2), (b"RL", 3)] {
                if self.starts_with(token) && !is_id_byte(self.peek(2)) {
                    direction = code;
                    self.i += 2;
                    break;
                }
            }
            self.skip_inline_space();
            match self.peek(0) {
                b'\n' | b';' | 0 => return Ok(direction),
                _ => return Err(Decline::Syntax),
            }
        }
    }

    fn statements(&mut self) -> Result<()> {
        loop {
            while !self.at_end() && (self.s[self.i].is_ascii_whitespace() || self.s[self.i] == b';') {
                self.i += 1;
            }
            if self.at_end() {
                return Ok(());
            }
            if self.starts_with(b"%%") {
                // Mermaid reads `%%` as a comment only at the start of a line;
                // after a statement it lexes as part of an id and fails.
                let line_start = self.s[..self.i].iter().rposition(|&b| b == b'\n').map_or(0, |p| p + 1);
                if !self.s[line_start..self.i].iter().all(|&b| is_inline_space(b)) {
                    return Err(Decline::Unsupported);
                }
                self.skip_line();
                continue;
            }
            let keyword_end = {
                let mut j = self.i;
                while j < self.s.len() && self.s[j].is_ascii_alphabetic() {
                    j += 1;
                }
                j
            };
            let keyword = &self.s[self.i..keyword_end];
            let spaced = keyword_end < self.s.len() && is_inline_space(self.s[keyword_end]);
            match keyword {
                b"classDef" if spaced => {
                    self.i = keyword_end;
                    self.class_def()?;
                }
                b"class" if spaced => {
                    self.i = keyword_end;
                    self.class_statement()?;
                }
                b"style" if spaced => {
                    self.i = keyword_end;
                    self.style_statement()?;
                }
                // Styling of links and click handlers change nothing this
                // engine draws; the rest of the statement is skipped.
                b"linkStyle" | b"click" if spaced => {
                    self.skip_line();
                }
                b"subgraph" | b"end" | b"direction" | b"accTitle" | b"accDescr" | b"title" => {
                    return Err(Decline::Unsupported);
                }
                _ => self.vertex_statement()?,
            }
        }
    }

    fn at_statement_end(&self) -> bool {
        self.at_end() || matches!(self.s[self.i], b'\n' | b';')
    }

    /// `A --> B & C -- text --> D`
    fn vertex_statement(&mut self) -> Result<()> {
        let mut group = self.node_group()?;
        loop {
            self.skip_inline_space();
            if self.at_statement_end() {
                return Ok(());
            }
            let link = self.link()?;
            self.skip_inline_space();
            let next = self.node_group()?;
            for &source in &group {
                for &target in &next {
                    self.edges.push(Edge {
                        source,
                        target,
                        label: link.label,
                        stroke: link.stroke,
                        end: link.end,
                        start: link.start,
                    });
                }
            }
            group = next;
        }
    }

    fn node_group(&mut self) -> Result<Vec<u32>> {
        let mut group = vec![self.node()?];
        loop {
            let save = self.i;
            self.skip_inline_space();
            if self.peek(0) == b'&' {
                self.i += 1;
                self.skip_inline_space();
                group.push(self.node()?);
            } else {
                self.i = save;
                return Ok(group);
            }
        }
    }

    fn id(&mut self) -> Result<Span> {
        let start = self.i;
        while !self.at_end() {
            let b = self.s[self.i];
            if is_id_byte(b) {
                self.i += 1;
            } else if b == b'-' && is_id_byte(self.peek(1)) && self.i > start {
                self.i += 1;
            } else {
                break;
            }
        }
        if self.i == start {
            return Err(Decline::Syntax);
        }
        // Characters Mermaid would fold into the id, which this scanner does
        // not model: let Mermaid decide.
        if matches!(self.peek(0), b'!' | b'"' | b'#' | b'$' | b'%' | b'\'' | b'*' | b'+' | b'?' | b'\\' | b'/' | b'`' | b'@') {
            return Err(Decline::Unsupported);
        }
        // Mermaid's id token swallows a trailing dot (`A.->B` is id `A.`).
        if self.peek(0) == b'.' {
            return Err(Decline::Unsupported);
        }
        let id = &self.s[start..self.i];
        if id == b"end" {
            return Err(Decline::Unsupported);
        }
        Ok(self.span(start, self.i))
    }

    fn vertex(&mut self, id: Span) -> u32 {
        let key = &self.s[id.start as usize..id.end as usize];
        if let Some(&index) = self.index.get(key) {
            return index;
        }
        let index = self.nodes.len() as u32;
        self.nodes.push(Node { id: Some(id), ..Node::default() });
        self.index.insert(key, index);
        index
    }

    fn node(&mut self) -> Result<u32> {
        let id = self.id()?;
        let index = self.vertex(id);
        if let Some((shape, label)) = self.shape()? {
            let node = &mut self.nodes[index as usize];
            node.shape = shape;
            node.label = Some(label);
        }
        if self.starts_with(b":::") {
            self.i += 3;
            let start = self.i;
            while !self.at_end() && (is_id_byte(self.s[self.i]) || self.s[self.i] == b'-') {
                self.i += 1;
            }
            if self.i == start {
                return Err(Decline::Syntax);
            }
            let class = self.span(start, self.i);
            self.nodes[index as usize].classes.push(class);
        }
        Ok(index)
    }

    /// A shape and its label, if one follows the id.
    fn shape(&mut self) -> Result<Option<(u32, Span)>> {
        // Longest openers first, as Mermaid's lexer orders them.
        const OPENERS: [(&[u8], &[u8], u32); 13] = [
            (b"(((", b")))", 7),
            (b"((", b"))", 6),
            (b"([", b"])", 3),
            (b"(-", b"-)", 8),
            (b"[[", b"]]", 4),
            (b"[(", b")]", 5),
            (b"{{", b"}}", 11),
            (b"[/", b"", 12),
            (b"[\\", b"", 13),
            (b"(", b")", 2),
            (b"[", b"]", 1),
            (b"{", b"}", 10),
            (b">", b"]", 9),
        ];
        if self.starts_with(b"[|") {
            return Err(Decline::Unsupported);
        }
        for (open, close, shape) in OPENERS {
            if !self.starts_with(open) {
                continue;
            }
            self.i += open.len();
            if close.is_empty() {
                // Parallelograms and trapezoids close with either slash.
                return self.slanted(shape).map(Some);
            }
            let label = self.label_until(close)?;
            self.i += close.len();
            return Ok(Some((shape, label)));
        }
        Ok(None)
    }

    fn slanted(&mut self, opened_with: u32) -> Result<(u32, Span)> {
        let label = self.label_until_any(&[b"/]", b"\\]"])?;
        let forward = self.peek(0) == b'/';
        self.i += 2;
        let shape = match (opened_with, forward) {
            (12, true) => 12,                   // [/ /]  lean_right
            (13, false) => 13,                  // [\ \]  lean_left
            (12, false) => 14,                  // [/ \]  trapezoid
            _ => SHAPE_INV_TRAPEZOID,           // [\ /]  inv_trapezoid
        };
        Ok((shape, label))
    }

    fn label_until(&mut self, close: &[u8]) -> Result<Span> {
        self.label_until_any(&[close])
    }

    /// Label text up to (not including) the first of `closes`.
    fn label_until_any(&mut self, closes: &[&[u8]]) -> Result<Span> {
        self.skip_inline_space();
        if self.peek(0) == b'"' {
            let start = self.i + 1;
            let mut j = start;
            while j < self.s.len() && self.s[j] != b'"' {
                if self.s[j] == b'\n' {
                    return Err(Decline::Syntax);
                }
                j += 1;
            }
            if j >= self.s.len() {
                return Err(Decline::Syntax);
            }
            let label = self.span(start, j);
            self.i = j + 1;
            self.skip_inline_space();
            if !closes.iter().any(|c| self.starts_with(c)) {
                return Err(Decline::Syntax);
            }
            return Ok(label);
        }
        let start = self.i;
        loop {
            if self.at_end() {
                return Err(Decline::Syntax);
            }
            if closes.iter().any(|c| self.starts_with(c)) {
                break;
            }
            match self.s[self.i] {
                b'\n' | b'"' | b'[' | b']' | b'(' | b')' | b'{' | b'}' => return Err(Decline::Unsupported),
                _ => self.i += 1,
            }
        }
        let label = self.trimmed(start, self.i);
        if label.start == label.end {
            return Err(Decline::Syntax);
        }
        Ok(label)
    }

    fn link(&mut self) -> Result<Link> {
        let marker = match self.peek(0) {
            b'<' => HEAD_POINT,
            b'x' if matches!(self.peek(1), b'-' | b'=' | b'.') => HEAD_CROSS,
            b'o' if matches!(self.peek(1), b'-' | b'=' | b'.') => HEAD_CIRCLE,
            _ => HEAD_NONE,
        };
        if marker != HEAD_NONE {
            self.i += 1;
        }

        let mut link = if self.starts_with(b"~~~") {
            while self.peek(0) == b'~' {
                self.i += 1;
            }
            Link { stroke: STROKE_INVISIBLE, end: HEAD_NONE, start: HEAD_NONE, label: None }
        } else if self.starts_with(b"--") {
            self.solid(b'-', STROKE_NORMAL)?
        } else if self.starts_with(b"==") {
            self.solid(b'=', STROKE_THICK)?
        } else if self.starts_with(b"-.") || self.starts_with(b".") {
            self.dotted()?
        } else {
            return Err(Decline::Syntax);
        };

        // Mermaid only accepts a start marker that mirrors the end one.
        if marker != HEAD_NONE {
            if marker != link.end {
                return Err(Decline::Syntax);
            }
            link.start = marker;
        }

        self.skip_inline_space();
        if self.peek(0) == b'|' {
            if link.label.is_some() {
                return Err(Decline::Syntax);
            }
            self.i += 1;
            let label = self.label_until(b"|")?;
            self.i += 1;
            link.label = Some(label);
        }
        Ok(link)
    }

    fn head(byte: u8) -> u32 {
        match byte {
            b'>' => HEAD_POINT,
            b'x' => HEAD_CROSS,
            b'o' => HEAD_CIRCLE,
            _ => HEAD_NONE,
        }
    }

    /// `--+[-xo>]` / `==+[=xo>]`, or the opener of `-- text -->`.
    fn solid(&mut self, bar: u8, stroke: u32) -> Result<Link> {
        let run = self.s[self.i..].iter().take_while(|&&b| b == bar).count();
        let after = self.peek(run);
        if matches!(after, b'>' | b'x' | b'o') {
            self.i += run + 1;
            return Ok(Link { stroke, end: Self::head(after), start: HEAD_NONE, label: None });
        }
        if run >= 3 {
            self.i += run;
            return Ok(Link { stroke, end: HEAD_NONE, start: HEAD_NONE, label: None });
        }
        // `-- text -->`: text may hold single bars but never a double one.
        self.i += run;
        let start = self.i;
        while !(self.peek(0) == bar && self.peek(1) == bar) {
            if self.at_end() || self.s[self.i] == b'\n' {
                return Err(Decline::Syntax);
            }
            self.i += 1;
        }
        let label = self.trimmed(start, self.i);
        let run = self.s[self.i..].iter().take_while(|&&b| b == bar).count();
        let after = self.peek(run);
        let end = if matches!(after, b'>' | b'x' | b'o') {
            self.i += run + 1;
            Self::head(after)
        } else if run >= 3 {
            self.i += run;
            HEAD_NONE
        } else {
            return Err(Decline::Syntax);
        };
        Ok(Link { stroke, end, start: HEAD_NONE, label: (label.start < label.end).then_some(label) })
    }

    /// `-?\.+-[xo>]?`, or the opener of `-. text .->`.
    fn dotted(&mut self) -> Result<Link> {
        let dashed = self.peek(0) == b'-';
        if dashed {
            self.i += 1;
        }
        let dots = self.s[self.i..].iter().take_while(|&&b| b == b'.').count();
        if dots == 0 {
            return Err(Decline::Syntax);
        }
        if self.peek(dots) == b'-' {
            self.i += dots + 1;
            let end = Self::head(self.peek(0));
            if end != HEAD_NONE {
                self.i += 1;
            }
            return Ok(Link { stroke: STROKE_DOTTED, end, start: HEAD_NONE, label: None });
        }
        if !dashed || dots != 1 {
            return Err(Decline::Syntax);
        }
        // `-. text .->`: the text cannot contain a dot at all.
        self.i += 1;
        let start = self.i;
        while self.peek(0) != b'.' {
            if self.at_end() || self.s[self.i] == b'\n' {
                return Err(Decline::Syntax);
            }
            self.i += 1;
        }
        let label = self.trimmed(start, self.i);
        let dots = self.s[self.i..].iter().take_while(|&&b| b == b'.').count();
        if self.peek(dots) != b'-' {
            return Err(Decline::Syntax);
        }
        self.i += dots + 1;
        let end = Self::head(self.peek(0));
        if end != HEAD_NONE {
            self.i += 1;
        }
        Ok(Link { stroke: STROKE_DOTTED, end, start: HEAD_NONE, label: (label.start < label.end).then_some(label) })
    }

    /// Comma-separated names up to the next space.
    fn names(&mut self) -> Result<Vec<Span>> {
        self.skip_inline_space();
        let mut names = Vec::new();
        loop {
            let start = self.i;
            while !self.at_end() && (is_id_byte(self.s[self.i]) || self.s[self.i] == b'-') {
                self.i += 1;
            }
            if self.i == start {
                return Err(Decline::Syntax);
            }
            names.push(self.span(start, self.i));
            if self.peek(0) == b',' {
                self.i += 1;
                continue;
            }
            return Ok(names);
        }
    }

    /// `fill:#f9f,stroke:#333` to the end of the statement, split on commas.
    fn styles(&mut self) -> Result<Vec<Span>> {
        self.skip_inline_space();
        let mut styles = Vec::new();
        let mut start = self.i;
        while !self.at_end() && !matches!(self.s[self.i], b'\n' | b';') {
            if self.s[self.i] == b',' {
                styles.push(self.trimmed(start, self.i));
                start = self.i + 1;
            }
            self.i += 1;
        }
        styles.push(self.trimmed(start, self.i));
        styles.retain(|s| s.start < s.end);
        Ok(styles)
    }

    fn text(&self, span: Span) -> &'a [u8] {
        &self.s[span.start as usize..span.end as usize]
    }

    fn class_def(&mut self) -> Result<()> {
        let names = self.names()?;
        let styles = self.styles()?;
        for name in names {
            let key = self.text(name);
            self.class_defs.entry(key).or_default().extend(styles.iter().copied());
        }
        Ok(())
    }

    fn class_statement(&mut self) -> Result<()> {
        let ids = self.names()?;
        let class = self.names()?;
        self.skip_inline_space();
        if class.len() != 1 || !self.at_statement_end() {
            return Err(Decline::Syntax);
        }
        for id in ids {
            // Mermaid applies a class only to vertices that already exist.
            if let Some(&index) = self.index.get(self.text(id)) {
                self.nodes[index as usize].classes.push(class[0]);
            }
        }
        Ok(())
    }

    fn style_statement(&mut self) -> Result<()> {
        self.skip_inline_space();
        let id = self.id()?;
        let index = self.vertex(id);
        let styles = self.styles()?;
        self.nodes[index as usize].styles.extend(styles);
        Ok(())
    }

    fn resolve_styles(&mut self) {
        let default = self.class_defs.get(&b"default"[..]).cloned().unwrap_or_default();
        for node in self.nodes.iter_mut() {
            let mut resolved = default.clone();
            for class in &node.classes {
                let key = &self.s[class.start as usize..class.end as usize];
                if let Some(styles) = self.class_defs.get(key) {
                    resolved.extend(styles.iter().copied());
                }
            }
            resolved.extend(node.styles.iter().copied());
            node.resolved = resolved;
        }
    }
}

struct Link {
    stroke: u32,
    end: u32,
    start: u32,
    label: Option<Span>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text<'a>(source: &'a str, span: Span) -> &'a str {
        &source[span.start as usize..span.end as usize]
    }

    fn ids(source: &str, parsed: &Parsed) -> Vec<String> {
        parsed.nodes.iter().map(|n| text(source, n.id.unwrap()).to_string()).collect()
    }

    #[test]
    fn chains_groups_and_shapes() {
        let src = "flowchart LR\n  A[Start] --> B{Ok?} -->|yes| C((Done))\n  A & B --> D([Pill]);E[(DB)]";
        let parsed = parse(src.as_bytes()).unwrap();
        assert_eq!(parsed.direction, 2);
        assert_eq!(ids(src, &parsed), ["A", "B", "C", "D", "E"]);
        let shapes: Vec<&str> = parsed.nodes.iter().map(|n| SHAPES[n.shape as usize]).collect();
        assert_eq!(shapes, ["square", "diamond", "circle", "stadium", "cylinder"]);
        let pairs: Vec<(u32, u32)> = parsed.edges.iter().map(|e| (e.source, e.target)).collect();
        assert_eq!(pairs, [(0, 1), (1, 2), (0, 3), (1, 3)]);
        assert_eq!(text(src, parsed.edges[1].label.unwrap()), "yes");
    }

    #[test]
    fn link_kinds() {
        let src = "graph TD\nA---B\nA-.->C\nA==>D\nA--xE\nA<-->F\nA~~~G\nA -- words here --> H\nA -. dotted .-> I\nA == thick ==> J\nA ---- K";
        let parsed = parse(src.as_bytes()).unwrap();
        let kinds: Vec<(u32, u32, u32)> = parsed.edges.iter().map(|e| (e.stroke, e.end, e.start)).collect();
        assert_eq!(
            kinds,
            [
                (STROKE_NORMAL, HEAD_NONE, HEAD_NONE),
                (STROKE_DOTTED, HEAD_POINT, HEAD_NONE),
                (STROKE_THICK, HEAD_POINT, HEAD_NONE),
                (STROKE_NORMAL, HEAD_CROSS, HEAD_NONE),
                (STROKE_NORMAL, HEAD_POINT, HEAD_POINT),
                (STROKE_INVISIBLE, HEAD_NONE, HEAD_NONE),
                (STROKE_NORMAL, HEAD_POINT, HEAD_NONE),
                (STROKE_DOTTED, HEAD_POINT, HEAD_NONE),
                (STROKE_THICK, HEAD_POINT, HEAD_NONE),
                (STROKE_NORMAL, HEAD_NONE, HEAD_NONE),
            ]
        );
        assert_eq!(text(src, parsed.edges[6].label.unwrap()), "words here");
        assert_eq!(text(src, parsed.edges[7].label.unwrap()), "dotted");
    }

    #[test]
    fn hyphenated_ids_and_quoted_labels() {
        let src = "flowchart TD\n  api-gateway[\"Gateway (edge)\"] --> auth-svc\n";
        let parsed = parse(src.as_bytes()).unwrap();
        assert_eq!(ids(src, &parsed), ["api-gateway", "auth-svc"]);
        assert_eq!(text(src, parsed.nodes[0].label.unwrap()), "Gateway (edge)");
    }

    #[test]
    fn styles_resolve_in_mermaid_order() {
        let src = "flowchart TD\nA:::hot --> B\nclassDef hot fill:#f96,stroke:#333\nclass B hot\nstyle B fill:#0f0\nclassDef default color:#111";
        let parsed = parse(src.as_bytes()).unwrap();
        let styles = |i: usize| -> Vec<&str> { parsed.nodes[i].resolved.iter().map(|&s| text(src, s)).collect() };
        assert_eq!(styles(0), ["color:#111", "fill:#f96", "stroke:#333"]);
        assert_eq!(styles(1), ["color:#111", "fill:#f96", "stroke:#333", "fill:#0f0"]);
    }

    #[test]
    fn front_matter_comments_and_semicolons() {
        let src = "---\ntitle: x\n---\n%% hello\nflowchart TD;\nA-->B; B-->C\n  %% indented comment\n%%{init: {}}%%\n";
        let parsed = parse(src.as_bytes()).unwrap();
        assert_eq!(parsed.nodes.len(), 3);
        assert_eq!(parsed.edges.len(), 2);
    }

    #[test]
    fn declines_what_it_does_not_model() {
        for src in [
            "flowchart TD\nsubgraph one\nA-->B\nend",
            "flowchart TD\nA@{ shape: rect }",
            "flowchart TD\ne1@-->B",
            "flowchart TD\nA-->B\ndirection LR",
            "sequenceDiagram\nA->>B: hi",
            "flowchart-elk TD\nA-->B",
            "flowchart TD\nA[unclosed --> B",
            "flowchart TD\nA <--x B",
            "flowchart TD\nA-->B %% trailing comment",
        ] {
            assert!(parse(src.as_bytes()).is_err(), "should decline: {src}");
        }
    }
}
