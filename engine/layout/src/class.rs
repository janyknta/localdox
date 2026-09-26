//! A fast path for Mermaid's `classDiagram` syntax.
//!
//! Mermaid's class parser takes ~3s on 2,000 classes, all of it on the main
//! thread. Generated class diagrams (from code, from schemas) use a small,
//! regular slice of the grammar, scanned here in one pass:
//!
//! ```text
//! classDiagram
//!   direction LR
//!   class Animal {
//!     <<interface>>
//!     +int age
//!     +isMammal() bool
//!   }
//!   Animal : +String name
//!   Animal <|-- Duck
//!   Duck *-- Leg : has
//!   Duck ..> Pond
//! ```
//!
//! Member lines come back raw; the caller applies Mermaid's own member rules
//! (visibility, `name() : return`, classifiers) so both parsers yield the same
//! text. Anything outside the slice — generics (`~T~`), cardinalities, notes,
//! namespaces, styling, callbacks, `X["label"]` — declines, and Mermaid parses.

use crate::parser::{Decline, Span};
use std::collections::HashMap;

/// Relation end types, in Mermaid's arrow-marker vocabulary.
pub const END_NONE: u32 = 0;
pub const END_AGGREGATION: u32 = 1; // o
pub const END_EXTENSION: u32 = 2; // <|  |>
pub const END_COMPOSITION: u32 = 3; // *
pub const END_DEPENDENCY: u32 = 4; // <  >
pub const END_LOLLIPOP: u32 = 5; // ()

#[derive(Debug, Default)]
pub struct Class {
    pub name: Span,
    /// Raw member lines, in order; annotations (`<<interface>>`) included.
    pub members: Vec<Span>,
}

#[derive(Debug)]
pub struct Relation {
    pub a: u32,
    pub b: u32,
    pub label: Option<Span>,
    pub start: u32,
    pub end: u32,
    pub dashed: bool,
}

#[derive(Debug, Default)]
pub struct ClassParsed {
    pub direction: u32,
    pub classes: Vec<Class>,
    pub relations: Vec<Relation>,
}

type Result<T> = std::result::Result<T, Decline>;

struct Scanner<'a> {
    s: &'a [u8],
    i: usize,
    classes: Vec<Class>,
    index: HashMap<&'a [u8], u32>,
    relations: Vec<Relation>,
    direction: u32,
}

#[inline]
fn is_name_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b >= 0x80
}

#[inline]
fn is_space(b: u8) -> bool {
    b == b' ' || b == b'\t' || b == b'\r'
}

pub fn parse(source: &[u8]) -> std::result::Result<ClassParsed, Decline> {
    // Generics are rewritten by Mermaid in ways not worth mirroring here.
    if source.contains(&b'~') {
        return Err(Decline::Unsupported);
    }
    let mut scanner = Scanner {
        s: source,
        i: 0,
        classes: Vec::new(),
        index: HashMap::new(),
        relations: Vec::new(),
        direction: 0,
    };
    scanner.header()?;
    scanner.statements()?;
    Ok(ClassParsed { direction: scanner.direction, classes: scanner.classes, relations: scanner.relations })
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

    fn line_start_is_blank(&self) -> bool {
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
            return if line == b"classDiagram" || line == b"classDiagram-v2" {
                Ok(())
            } else {
                Err(Decline::NoHeader)
            };
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
                if !self.line_start_is_blank() {
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
            if self.starts_with(b"class") && is_space(self.peek(5)) {
                self.i += 5;
                self.skip_space();
                self.class_statement()?;
                continue;
            }
            for keyword in [
                &b"note"[..],
                b"namespace",
                b"click",
                b"link",
                b"callback",
                b"style",
                b"cssClass",
                b"classDef",
                b"title",
                b"accTitle",
                b"accDescr",
                b"<<",
            ] {
                if self.starts_with(keyword) {
                    return Err(Decline::Unsupported);
                }
            }
            self.name_statement()?;
        }
    }

    fn name(&mut self) -> Result<Span> {
        let start = self.i;
        while !self.at_end() && is_name_byte(self.s[self.i]) {
            self.i += 1;
        }
        if self.i == start {
            return Err(Decline::Syntax);
        }
        // `X["label"]`, `X:::style` and friends are Mermaid's to read.
        if matches!(self.peek(0), b'[' | b'"' | b'`' | b'.') || self.starts_with(b":::") {
            return Err(Decline::Unsupported);
        }
        Ok(self.span(start, self.i))
    }

    fn class(&mut self, name: Span) -> u32 {
        let key = &self.s[name.start as usize..name.end as usize];
        if let Some(&index) = self.index.get(key) {
            return index;
        }
        let index = self.classes.len() as u32;
        self.classes.push(Class { name, ..Class::default() });
        self.index.insert(key, index);
        index
    }

    /// `class Name` or `class Name { … }`
    fn class_statement(&mut self) -> Result<()> {
        let name = self.name()?;
        let class = self.class(name);
        self.skip_space();
        if self.at_line_end() {
            return Ok(());
        }
        if self.peek(0) != b'{' {
            return Err(Decline::Unsupported);
        }
        self.i += 1;
        self.skip_space();
        if !self.at_line_end() {
            return Err(Decline::Unsupported);
        }
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
            let start = self.i;
            self.skip_line();
            let member = trim_span(self.s, self.span(start, self.i));
            self.member(class, member)?;
        }
    }

    fn member(&mut self, class: u32, member: Span) -> Result<()> {
        let text = &self.s[member.start as usize..member.end as usize];
        if text.is_empty() || text.starts_with(b"%%") {
            return Err(Decline::Unsupported);
        }
        let annotation = text.starts_with(b"<<") && text.ends_with(b">>");
        // Mermaid sanitises member HTML and entities; not worth mirroring.
        let inner = if annotation { &text[2..text.len() - 2] } else { text };
        if inner.iter().any(|&b| matches!(b, b'<' | b'>' | b'&' | b'{' | b'}' | b'"' | b'`')) {
            return Err(Decline::Unsupported);
        }
        self.classes[class as usize].members.push(member);
        Ok(())
    }

    /// `Name : member` or a relation.
    fn name_statement(&mut self) -> Result<()> {
        let name = self.name()?;
        let a = self.class(name);
        self.skip_space();
        if self.peek(0) == b':' {
            self.i += 1;
            self.skip_space();
            let start = self.i;
            self.skip_line();
            let member = trim_span(self.s, self.span(start, self.i));
            return self.member(a, member);
        }
        if self.at_line_end() {
            return Ok(());
        }
        self.relation(a)
    }

    fn end_type(&mut self, left: bool) -> u32 {
        let pairs: [(&[u8], u32); 6] = if left {
            [
                (b"<|", END_EXTENSION),
                (b"()", END_LOLLIPOP),
                (b"*", END_COMPOSITION),
                (b"o", END_AGGREGATION),
                (b"<", END_DEPENDENCY),
                (b"", END_NONE),
            ]
        } else {
            [
                (b"|>", END_EXTENSION),
                (b"()", END_LOLLIPOP),
                (b"*", END_COMPOSITION),
                (b"o", END_AGGREGATION),
                (b">", END_DEPENDENCY),
                (b"", END_NONE),
            ]
        };
        for (token, code) in pairs {
            if token.is_empty() || !self.starts_with(token) {
                continue;
            }
            // `o` is also a letter: as a marker it must touch the line on the
            // left (`o--`) and stand apart from the class name on the right.
            let after = self.peek(token.len());
            if token == b"o" && (if left { !matches!(after, b'-' | b'.') } else { !is_space(after) }) {
                continue;
            }
            self.i += token.len();
            return code;
        }
        END_NONE
    }

    /// `A <|-- B`, `A *-- B : label`, `A ..> B`
    fn relation(&mut self, a: u32) -> Result<()> {
        if self.peek(0) == b'"' {
            return Err(Decline::Unsupported); // cardinality labels
        }
        let start = self.end_type(true);
        let dashed = match (self.peek(0), self.peek(1)) {
            (b'-', b'-') => false,
            (b'.', b'.') => true,
            _ => return Err(Decline::Unsupported),
        };
        self.i += 2;
        let end = self.end_type(false);
        self.skip_space();
        if self.peek(0) == b'"' {
            return Err(Decline::Unsupported);
        }
        let name = self.name()?;
        let b = self.class(name);
        self.skip_space();
        let mut label = None;
        if self.peek(0) == b':' {
            self.i += 1;
            self.skip_space();
            let from = self.i;
            self.skip_line();
            let span = trim_span(self.s, self.span(from, self.i));
            let text = &self.s[span.start as usize..span.end as usize];
            if text.iter().any(|&b| matches!(b, b'<' | b'>' | b'&' | b'"' | b'`')) {
                return Err(Decline::Unsupported);
            }
            label = (span.start < span.end).then_some(span);
        }
        if !self.at_line_end() {
            return Err(Decline::Syntax);
        }
        self.relations.push(Relation { a, b, label, start, end, dashed });
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
    fn classes_members_and_relations() {
        let src = "classDiagram\n  direction LR\n  class Animal {\n    <<interface>>\n    +int age\n    +isMammal() bool\n  }\n  Animal : +String name\n  Animal <|-- Duck\n  Duck *-- Leg : has\n  Duck ..> Pond\n  Duck --o Egg\n";
        let parsed = parse(src.as_bytes()).unwrap();
        assert_eq!(parsed.direction, 2);
        let names: Vec<&str> = parsed.classes.iter().map(|c| text(src, c.name)).collect();
        assert_eq!(names, ["Animal", "Duck", "Leg", "Pond", "Egg"]);
        let members: Vec<&str> = parsed.classes[0].members.iter().map(|&m| text(src, m)).collect();
        assert_eq!(members, ["<<interface>>", "+int age", "+isMammal() bool", "+String name"]);
        let r = &parsed.relations;
        assert_eq!((r[0].start, r[0].end, r[0].dashed), (END_EXTENSION, END_NONE, false));
        assert_eq!((r[1].start, r[1].end), (END_COMPOSITION, END_NONE));
        assert_eq!(text(src, r[1].label.unwrap()), "has");
        assert_eq!((r[2].start, r[2].end, r[2].dashed), (END_NONE, END_DEPENDENCY, true));
        assert_eq!((r[3].start, r[3].end), (END_NONE, END_AGGREGATION));
    }

    #[test]
    fn declines_what_it_does_not_model() {
        for src in [
            "classDiagram\n  class Box~T~",
            "classDiagram\n  A \"1\" --> \"*\" B",
            "classDiagram\n  note for A \"hi\"",
            "classDiagram\n  namespace N {\n  class A\n  }",
            "classDiagram\n  class A[\"Label\"]",
            "classDiagram\n  <<interface>> A",
            "classDiagram\n  A --> B %% trailing",
            "flowchart TD\n  A-->B",
        ] {
            assert!(parse(src.as_bytes()).is_err(), "should decline: {src}");
        }
    }
}
