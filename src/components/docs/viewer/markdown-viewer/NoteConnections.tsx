import { useContext, useState } from "react";
import { Link2, ChevronDown } from "lucide-react";
import { WorkspaceLinksContext } from "../../workspace/WorkspaceLinksContext";
import { filePath } from "@/lib/markdown/media-references";
import { noteName } from "@/lib/markdown/note-links";

export function NoteConnections({ fileId }: { fileId: string }) {
  const workspace = useContext(WorkspaceLinksContext);
  const [open, setOpen] = useState(false);
  if (!workspace) return null;
  const incoming = workspace.links.filter(
    (link) => link.targetId === fileId && link.sourceId !== fileId,
  );
  const outgoing = workspace.links.filter((link) => link.sourceId === fileId);
  const sources = [...new Set(incoming.map((link) => link.sourceId))];
  return (
    <section aria-label="Note connections" className="mt-10 border-t border-border py-4 text-sm">
      <button
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-9 w-full items-center gap-2 rounded text-left text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11"
      >
        <Link2 aria-hidden className="h-4 w-4" />
        <span className="flex-1">
          Connections{" "}
          <span className="ml-2 text-xs">
            {sources.length} backlinks · {outgoing.length} outgoing
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="mt-3 grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="mb-2 text-xs font-medium text-muted-foreground">Backlinks</h2>
            {!sources.length && (
              <p className="text-xs text-muted-foreground">
                No notes link here yet. Type [[ in another note to connect it.
              </p>
            )}
            {sources.map((id) => {
              const file = workspace.files.find((item) => item.id === id)!;
              const link = incoming.find((item) => item.sourceId === id)!;
              const start = file.content.lastIndexOf("\n", link.from) + 1;
              const end = file.content.indexOf("\n", link.to);
              return (
                <button
                  key={id}
                  title={filePath(file, workspace.folders)}
                  onClick={() => workspace.follow(`/${filePath(file, workspace.folders)}`, fileId)}
                  className="mb-1 block w-full rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block truncate font-medium">{noteName(file.name)}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {file.content.slice(start, end < 0 ? undefined : end)}
                  </span>
                </button>
              );
            })}
          </div>
          <div>
            <h2 className="mb-2 text-xs font-medium text-muted-foreground">Outgoing links</h2>
            {!outgoing.length && (
              <p className="text-xs text-muted-foreground">
                Connect an idea by typing [[ in the editor.
              </p>
            )}
            {outgoing.map((link) => (
              <button
                key={link.from}
                onClick={() => workspace.follow(link.reference, fileId)}
                className="mb-1 flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="truncate">{link.label || link.reference}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {link.status === "missing"
                    ? "Create note"
                    : link.status === "ambiguous"
                      ? "Needs a path"
                      : link.embed
                        ? "Embed"
                        : ""}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
