# Routes

TanStack Start uses **file-based routing**. Every `.tsx` file in this directory
defines a route. Do **not** create `src/pages/`, `src/routes/_app/index.tsx`, or
`app/layout.tsx` — those are Next.js / Remix conventions. The only root layout
is `src/routes/__root.tsx`.

## Conventions

| File                     | URL                                                     |
| ------------------------ | ------------------------------------------------------- |
| `index.tsx`              | `/`                                                     |
| `about.tsx`              | `/about`                                                |
| `users/index.tsx`        | `/users`                                                |
| `users/$id.tsx`          | `/users/:id` (dynamic — bare `$`, no curly braces)      |
| `posts/{-$category}.tsx` | `/posts/:category?` (optional segment)                  |
| `files/$.tsx`            | `/files/*` (splat — read via `_splat` param, never `*`) |
| `_layout.tsx`            | layout route (renders children via `<Outlet />`)        |
| `__root.tsx`             | app shell — wraps every page; preserve `<Outlet />`     |

`routeTree.gen.ts` is auto-generated. Don't edit it by hand.

## App navigation

`_app.tsx` is the persistent workspace layout. Its child routes render destinations
without mounting a second workspace or resetting editors and persistence.

| URL                                      | Destination                                         |
| ---------------------------------------- | --------------------------------------------------- |
| `/`                                      | Last local workspace, or the empty workspace        |
| `/workspaces/:workspaceId`               | A local workspace                                   |
| `/workspaces/:workspaceId/files/:fileId` | Any file viewer, including exams and practice       |
| `/settings/:section`                     | A settings section                                  |
| `/settings/practice/:fileId`            | A practice file’s controls in the Settings modal     |
| `/settings/exams/:rulesId`               | The focused ruleset editor in the current workspace |

Use `workspacePath`, `settingsPath` and `readAppRoute` from `lib/app/routes.ts`
for destinations. IDs are encoded path segments; document headings use the URL
hash. File links restore the named workspace before selecting the file. These
links reference this device's local library; sharing files still uses the share flow.
`/md-reader`, `/exams` and `/settings` remain compatible entry points.

Browser history owns Back and Forward. The app's Back button dismisses an open
panel or mode first. Route blockers protect unsaved document and ruleset drafts.
Do not add another `popstate` listener that calls Back, or a separate navigation stack.
