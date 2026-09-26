/**
 * Flowcharts the Rust fast-path parser must read exactly as Mermaid does.
 *
 * `accepted` covers every construct the fast path claims to handle; for each,
 * its model must equal the one built from Mermaid's own parse. `declined` are
 * sources it must refuse, leaving them to Mermaid.
 */
import { syntheticFlowchart } from "./generate.ts";

export const accepted: Record<string, string> = {
  synthetic: syntheticFlowchart(800),
  shapes: `flowchart TD
  a[square] --> b(round) --> c([stadium]) --> d[[subroutine]] --> e[(cylinder)]
  e --> f((circle)) --> g(((double))) --> h>odd] --> i{diamond} --> j{{hexagon}}
  j --> k[/lean right/] --> l[\\lean left\\] --> m[/trapezoid\\] --> n[\\inverted/]
  n --> o(-ellipse-)`,
  links: `graph LR
  A---B
  A-.->C
  A==>D
  A--xE
  A--oF
  A<-->G
  Ax--xH
  A o--o I
  A~~~J
  A ---- K
  A -..-> L
  A ===> M`,
  labels: `flowchart TD
  A -->|pipe label| B
  A -- words on a line --> C
  A -. dotted words .-> D
  A == thick words ==> E
  A -->| spaced | F
  G["Quoted (with parens) & more"] --> H["Line one<br/>Line two"]
  I["Tom &amp; Jerry"] --> J["#quot;quoted#quot;"]
  K["\`**Markdown** string\`"] --> L[plain text with - dash]`,
  styles: `flowchart TD
  A:::hot --> B --> C
  classDef hot fill:#f96,stroke:#333,stroke-width:4px
  classDef cold fill:#9cf
  class B,C cold
  style C fill:#0f0,color:#fff
  classDef default stroke:#999`,
  structure: `---
title: Structure
---
%% leading comment
%%{init: {"theme": "neutral"}}%%
flowchart BT;
  A & B --> C & D;E-->F
    %% indented comment line
  F --> G --> H --> A
  click A "https://example.com"
  linkStyle 0 stroke:#f00
`,
  crlf: "flowchart RL\r\n  A --> B\r\n  B --> C\r\n",
  unicode: `flowchart TD
  café[Crème brûlée] --> 東京[東京駅] --> naïve`,
  hyphens: `graph
  api-gateway --> auth-svc & order-svc
  order-svc --> pay-svc-v2[Payments v2]`,
  erBasic: `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  CUSTOMER }|..|{ DELIVERY_ADDRESS : uses
  PRODUCT |o--o| CATEGORY : "belongs to"`,
  erAttributes: `erDiagram
  direction LR
  CUSTOMER["Customer account"] {
    string name PK "full name"
    varchar(255) email UK, FK
    int age
    string[] tags
  }
  ORDER {
    int id PK
    int customer_id FK "who placed it"
  }
  CUSTOMER ||--o{ ORDER : places
  LONELY`,
  erHyphens: `erDiagram
  order-item }o--|| order-header : "part of"
  order-header ||--o{ order-item : has`,
  classBasic: `classDiagram
  class Animal {
    <<interface>>
    +int age
    -String name$
    +isMammal() bool
    +mate(Animal other)*
    #eat(food) void$
  }
  Animal : +String gender
  Animal <|-- Duck
  Animal <|-- Fish
  Duck *-- Leg : has
  Duck o-- Egg
  Duck ..> Pond : swims in
  Fish ..|> Swimmer
  Egg -- Nest
  Nest .. Tree`,
  classDirection: `classDiagram
  direction LR
  class A
  class B {
    +go()
  }
  A --> B
  A --o C
  C <.. D`,
  defaultOnly: `flowchart TD
  A --> B
  classDef default fill:#eee,stroke:#111`,
};

export const declined: Record<string, string> = {
  classGenerics: `classDiagram
  class Box~T~`,
  classCardinality: `classDiagram
  A "1" --> "*" B`,
  classNote: `classDiagram
  A --> B
  note for A "hello"`,
  erWordCardinality: `erDiagram
  A one or more--zero or more B : x`,
  erQuotedName: `erDiagram
  "Quoted Name" ||--o{ B : x`,
  erClassDef: `erDiagram
  A ||--o{ B : x
  classDef hot fill:#f00`,
  subgraph: `flowchart TD
  subgraph one
    A --> B
  end`,
  shapeData: `flowchart TD
  A@{ shape: rect, label: "x" }`,
  edgeId: `flowchart TD
  A e1@--> B`,
  direction: `flowchart TD
  direction LR
  A --> B`,
  malformed: `flowchart TD
  A[unclosed --> B`,
  mismatchedMarkers: `flowchart TD
  A <--x B`,
  trailingComment: `flowchart TD
  A --> B %% not a comment to Mermaid`,
};
