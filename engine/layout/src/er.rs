//! A fast path for Mermaid's `erDiagram` syntax.
//!
//! Large ER diagrams are usually generated from a schema — hundreds of tables,
//! thousands of columns — and use a small, regular slice of the grammar:
//!
//! ```text
//! erDiagram
//!   direction LR
//!   CUSTOMER ||--o{ ORDER : places
//!   ORDER }|..|{ ADDRESS : "ships to"
//!   CUSTOMER["Customer account"] {
//!     string name PK "full name"
//!     int age
//!   }
//! ```
//!
//! That slice is scanned here in one pass. Like the flowchart scanner, it is
//! strict: word-form cardinalities (`one or more`), quoted entity names,
//! `classDef`/`style`, multi-word unquoted labels — anything outside the slice
//! makes it decline, and the caller asks Mermaid's parser instead. It never
//! guesses at a diagram Mermaid would read differently.

use crate::parser::{Decline, Span};
use std::collections::HashMap;

/// Cardinality at one end of a relationship, in the layout-data vocabulary.
pub const CARD_ONE: u32 = 1; // only_one        ||
pub const CARD_ZERO_ONE: u32 = 2; // zero_or_one  |o  o|
pub const CARD_ONE_MANY: u32 = 3; // one_or_more  }|  |{
pub const CARD_ZERO_MANY: u32 = 4; // zero_or_more }o o{

#[derive(Debug, Default)]
pub struct Entity {
    pub name: Span,
    pub alias: Option<Span>,
    pub attributes: Vec<Attribute>,
}

#[derive(Debug, Clone, Copy)]
pub struct Attribute {
    pub kind: Span,
    pub name: Span,
    pub keys: Option<Span>,
    pub comment: Option<Span>,
}

#[derive(Debug)]
pub struct Relationship {
    pub a: u32,
    pub b: u32,
    pub label: Option<Span>,
    pub card_a: u32,
    pub card_b: u32,
    pub identifying: bool,
}

#[derive(Debug, Default)]
pub struct ErParsed {
    pub direction: u32,
    pub entities: Vec<Entity>,
    pub relationships: Vec<Relationship>,
}

type Result<T> = std::result::Result<T, Decline>;

struct Scanner<'a> {
    s: &'a [u8],
    i: usize,
    entities: Vec<Entity>,
    index: HashMap<&'a [u8], u32>,
    relationships: Vec<Relationship>,
    direction: u32,
}

#[inline]
fn is_name_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b >= 0x80
}

/// Mermaid's attribute words also allow `*`, brackets and parentheses:
/// `varchar(255)`, `string[]`, `*id`.
#[inline]
fn is_attribute_byte(b: u8) -> bool {
    is_name_byte(b) || matches!(b, b'[' | b']' | b'(' | b')' | b'*')
}

#[inline]
fn is_space(b: u8) -> bool {
    b == b' ' || b == b'\t' || b == b'\r'
}

pub fn parse(source: &[u8]) -> std::result::Result<ErParsed, Decline> {
    let mut scanner = Scanner {
        s: source,
        i: 0,
        entities: Vec::new(),
        index: HashMap::new(),
        relationships: Vec::new(),
        direction: 0,
    };
    scanner.header()?;
    scanner.statements()?;
    Ok(ErParsed {
        direction: scanner.direction,
        entities: scanner.entities,
        relationships: scanner.relationships,
    })
}

impl<'a> Scanner<'a> {
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

    fn skip_space(&mut self) {
        while !self.at_end() && is_space(self.s[self.i]) {
            self.i += 1;
        }
    }

    fn skip_line(&mut self) {
        while !self.at_end() && self.s[self.i] != b'\n' {
            self.i += 1;
        }
    }

    fn at_line_end(&self) -> bool {
        self.at_end() || self.s[self.i] == b'\n'
    }

    /// Only a comment at the start of a line is a comment (as in Mermaid).
    fn comment_line(&self) -> bool {
        if !self.starts_with(b"%%") {
            return false;
        }
        let line_start = self.s[..self.i].iter().rposition(|&b| b == b'\n').map_or(0, |p| p + 1);
        self.s[line_start..self.i].iter().all(|&b| is_space(b))
    }

    fn header(&mut self) -> Result<()> {
        if self.s.starts_with(&[0xEF, 0xBB, 0xBF]) {
            self.i = 3;
        }
        let mut front_matter = false;
        loop {
            if self.at_end() {
                return Err(Decline::NoHeader);
            }
            let line_start = self.i;
            self.skip_line();
            let line = trim(&self.s[line_start..self.i]);
            if !self.at_end() {
                self.i += 1;
            }
            if line == b"---" {
                front_matter = !front_matter;
                continue;
            }
            if front_matter || line.is_empty() || line.starts_with(b"%%") {
                continue;
            }
            if line != b"erDiagram" {
                return Err(Decline::NoHeader);
            }
            return Ok(());
        }
    }

    fn statements(&mut self) -> Result<()> {
        loop {
            while !self.at_end() && self.s[self.i].is_ascii_whitespace() {
                self.i += 1;
            }
            if self.at_end() {
                return Ok(());
            }
            if self.starts_with(b"%%") {
                if !self.comment_line() {
                    return Err(Decline::Unsupported);
                }
                self.skip_line();
                continue;
            }
            if self.starts_with(b"direction") && is_space(self.peek(9)) {
                self.i += 9;
                self.skip_space();
                let mut found = false;
                for (token, code) in [(b"TB", 0), (b"TD", 0), (b"BT", 1), (b"LR", 2), (b"RL", 3)] {
                    if self.starts_with(token) && !is_name_byte(self.peek(2)) {
                        self.direction = code;
                        self.i += 2;
                        found = true;
                        break;
                    }
                }
                self.skip_space();
                if !found || !self.at_line_end() {
                    return Err(Decline::Syntax);
                }
                continue;
            }
            for keyword in [&b"title"[..], b"accTitle", b"accDescr", b"classDef", b"class", b"style"] {
                if self.starts_with(keyword) && !is_name_byte(self.peek(keyword.len())) {
                    return Err(Decline::Unsupported);
                }
            }
            self.statement()?;
        }
    }

    fn name(&mut self) -> Result<Span> {
        if self.peek(0) == b'"' {
            return Err(Decline::Unsupported);
        }
        let start = self.i;
        while !self.at_end() && is_name_byte(self.s[self.i]) {
            self.i += 1;
        }
        if self.i == start || self.s[start] == b'-' {
            return Err(Decline::Syntax);
        }
        Ok(self.span(start, self.i))
    }

    fn entity(&mut self, name: Span) -> u32 {
        let key = &self.s[name.start as usize..name.end as usize];
        if let Some(&index) = self.index.get(key) {
            return index;
        }
        let index = self.entities.len() as u32;
        self.entities.push(Entity { name, ..Entity::default() });
        self.index.insert(key, index);
        index
    }

    /// `"text"` → the span inside the quotes.
    fn quoted(&mut self) -> Result<Span> {
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
        self.i = j + 1;
        Ok(self.span(start, j))
    }

    fn statement(&mut self) -> Result<()> {
        let name = self.name()?;
        let a = self.entity(name);
        if self.peek(0) == b'[' {
            self.i += 1;
            self.skip_space();
            let alias = if self.peek(0) == b'"' {
                self.quoted()?
            } else {
                let start = self.i;
                while !self.at_end() && !matches!(self.s[self.i], b']' | b'\n') {
                    self.i += 1;
                }
                trim_span(self.s, self.span(start, self.i))
            };
            self.skip_space();
            if self.peek(0) != b']' {
                return Err(Decline::Syntax);
            }
            self.i += 1;
            self.entities[a as usize].alias = Some(alias);
        }
        self.skip_space();
        if self.peek(0) == b'{' {
            self.i += 1;
            return self.attributes(a);
        }
        if self.at_line_end() {
            return Ok(());
        }
        self.relationship(a)
    }

    fn attributes(&mut self, entity: u32) -> Result<()> {
        loop {
            while !self.at_end() && self.s[self.i].is_ascii_whitespace() {
                self.i += 1;
            }
            if self.at_end() {
                return Err(Decline::Syntax);
            }
            if self.peek(0) == b'}' {
                self.i += 1;
                self.skip_space();
                return if self.at_line_end() { Ok(()) } else { Err(Decline::Syntax) };
            }
            if self.starts_with(b"%%") {
                return Err(Decline::Unsupported);
            }
            let kind = self.attribute_word()?;
            self.skip_space();
            let name = self.attribute_word()?;
            self.skip_space();
            let mut keys = None;
            if self.starts_with(b"PK") || self.starts_with(b"FK") || self.starts_with(b"UK") {
                let start = self.i;
                loop {
                    if !(self.starts_with(b"PK") || self.starts_with(b"FK") || self.starts_with(b"UK")) {
                        return Err(Decline::Syntax);
                    }
                    self.i += 2;
                    let save = self.i;
                    self.skip_space();
                    if self.peek(0) == b',' {
                        self.i += 1;
                        self.skip_space();
                        continue;
                    }
                    self.i = save;
                    break;
                }
                keys = Some(self.span(start, self.i));
                self.skip_space();
            }
            let mut comment = None;
            if self.peek(0) == b'"' {
                comment = Some(self.quoted()?);
                self.skip_space();
            }
            if !self.at_line_end() {
                return Err(Decline::Syntax);
            }
            self.entities[entity as usize].attributes.push(Attribute { kind, name, keys, comment });
        }
    }

    fn attribute_word(&mut self) -> Result<Span> {
        let start = self.i;
        while !self.at_end() && is_attribute_byte(self.s[self.i]) {
            self.i += 1;
        }
        if self.i == start {
            return Err(Decline::Syntax);
        }
        Ok(self.span(start, self.i))
    }

    /// `||--o{ ORDER : places`
    fn relationship(&mut self, a: u32) -> Result<()> {
        let card_a = match (self.peek(0), self.peek(1)) {
            (b'|', b'|') => CARD_ONE,
            (b'|', b'o') => CARD_ZERO_ONE,
            (b'}', b'|') => CARD_ONE_MANY,
            (b'}', b'o') => CARD_ZERO_MANY,
            _ => return Err(Decline::Unsupported),
        };
        self.i += 2;
        let identifying = match (self.peek(0), self.peek(1)) {
            (b'-', b'-') => true,
            (b'.', b'.') => false,
            _ => return Err(Decline::Unsupported),
        };
        self.i += 2;
        let card_b = match (self.peek(0), self.peek(1)) {
            (b'|', b'|') => CARD_ONE,
            (b'o', b'|') => CARD_ZERO_ONE,
            (b'|', b'{') => CARD_ONE_MANY,
            (b'o', b'{') => CARD_ZERO_MANY,
            _ => return Err(Decline::Unsupported),
        };
        self.i += 2;
        self.skip_space();
        let name = self.name()?;
        let b = self.entity(name);
        self.skip_space();
        if self.peek(0) != b':' {
            return Err(Decline::Unsupported);
        }
        self.i += 1;
        self.skip_space();
        let label = if self.peek(0) == b'"' {
            self.quoted()?
        } else {
            // One word, as Mermaid's grammar allows unquoted.
            let start = self.i;
            while !self.at_end() && is_name_byte(self.s[self.i]) {
                self.i += 1;
            }
            if self.i == start {
                return Err(Decline::Syntax);
            }
            self.span(start, self.i)
        };
        self.skip_space();
        if !self.at_line_end() {
            return Err(Decline::Unsupported);
        }
        self.relationships.push(Relationship {
            a,
            b,
            label: (label.start < label.end).then_some(label),
            card_a,
            card_b,
            identifying,
        });
        Ok(())
    }
}

fn trim(bytes: &[u8]) -> &[u8] {
    let start = bytes.iter().position(|b| !b.is_ascii_whitespace()).unwrap_or(bytes.len());
    let end = bytes.iter().rposition(|b| !b.is_ascii_whitespace()).map_or(start, |p| p + 1);
    &bytes[start..end]
}

fn trim_span(s: &[u8], span: Span) -> Span {
    let mut start = span.start as usize;
    let mut end = span.end as usize;
    while start < end && s[start].is_ascii_whitespace() {
        start += 1;
    }
    while end > start && s[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    Span { start: start as u32, end: end as u32 }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text<'a>(src: &'a str, span: Span) -> &'a str {
        &src[span.start as usize..span.end as usize]
    }

    #[test]
    fn entities_attributes_and_relationships() {
        let src = "erDiagram\n  direction LR\n  CUSTOMER ||--o{ ORDER : places\n  ORDER }|..|{ ADDRESS : \"ships to\"\n  CUSTOMER[\"Customer account\"] {\n    string name PK \"full name\"\n    varchar(255) email UK, FK\n    int age\n  }\n";
        let parsed = parse(src.as_bytes()).unwrap();
        assert_eq!(parsed.direction, 2);
        let names: Vec<&str> = parsed.entities.iter().map(|e| text(src, e.name)).collect();
        assert_eq!(names, ["CUSTOMER", "ORDER", "ADDRESS"]);
        assert_eq!(text(src, parsed.entities[0].alias.unwrap()), "Customer account");
        let attrs = &parsed.entities[0].attributes;
        assert_eq!(attrs.len(), 3);
        assert_eq!(text(src, attrs[0].kind), "string");
        assert_eq!(text(src, attrs[0].keys.unwrap()), "PK");
        assert_eq!(text(src, attrs[0].comment.unwrap()), "full name");
        assert_eq!(text(src, attrs[1].kind), "varchar(255)");
        assert_eq!(text(src, attrs[1].keys.unwrap()), "UK, FK");
        let r = &parsed.relationships;
        assert_eq!((r[0].card_a, r[0].card_b, r[0].identifying), (CARD_ONE, CARD_ZERO_MANY, true));
        assert_eq!((r[1].card_a, r[1].card_b, r[1].identifying), (CARD_ONE_MANY, CARD_ONE_MANY, false));
        assert_eq!(text(src, r[1].label.unwrap()), "ships to");
    }

    #[test]
    fn declines_what_it_does_not_model() {
        for src in [
            "erDiagram\n  A one or more--zero or more B : x",
            "erDiagram\n  \"quoted name\" ||--o{ B : x",
            "erDiagram\n  A ||--o{ B : two words",
            "erDiagram\n  A ||--o{ B",
            "erDiagram\n  classDef hot fill:#f00",
            "erDiagram\n  A ||--o{ B : x %% trailing",
            "flowchart TD\n  A-->B",
        ] {
            assert!(parse(src.as_bytes()).is_err(), "should decline: {src}");
        }
    }
}
