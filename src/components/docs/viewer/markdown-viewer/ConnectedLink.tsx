import { useContext, useState, useRef, useEffect, type ReactNode } from "react";
import { WorkspaceLinksContext } from "../../workspace/WorkspaceLinksContext";
import {
  resolveNoteLink,
  noteAliases,
  noteName,
  splitNoteReference,
} from "@/lib/markdown/note-links";
import { filePath } from "@/lib/markdown/media-references";

export function ConnectedLink({
  reference,
  sourceId,
  children,
}: {
  reference: string;
  sourceId: string;
  children: ReactNode;
}) {
  const workspace = useContext(WorkspaceLinksContext);
  const [choosing, setChoosing] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!choosing) return;
    root.current?.querySelector("button")?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setChoosing(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [choosing]);
  if (!workspace) return <span>{children}</span>;
  const source = workspace.files.find((file) => file.id === sourceId);
  if (!source) return <span>{children}</span>;
  const resolved = resolveNoteLink(reference, source, workspace.files, workspace.folders);
  const name = splitNoteReference(reference).name.toLowerCase();
  const candidates =
    resolved.status === "ambiguous"
      ? workspace.files.filter(
          (file) =>
            !file.deletedAt &&
            [
              file.name,
              noteName(file.name),
              filePath(file, workspace.folders),
              noteName(filePath(file, workspace.folders)),
              ...noteAliases(file.content),
            ].some((label) => label.toLowerCase() === name.replace(/^\//, "")),
        )
      : [];
  return (
    <span
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && choosing) {
          event.stopPropagation();
          setChoosing(false);
          root.current?.querySelector("a")?.focus();
        }
      }}
    >
      <a
        href="#"
        data-note-link={reference}
        data-link-status={resolved.status}
        aria-expanded={resolved.status === "ambiguous" ? choosing : undefined}
        title={
          resolved.status === "missing"
            ? `Create ${reference}`
            : resolved.status === "ambiguous"
              ? `Choose a note for ${reference}`
              : `Open ${reference}`
        }
        className={
          resolved.status === "found"
            ? "docs-note-link"
            : "docs-note-link docs-note-link-unresolved"
        }
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (resolved.status === "ambiguous") setChoosing((value) => !value);
          else workspace.follow(reference, sourceId);
        }}
      >
        {children}
      </a>
      {choosing && (
        <span
          role="group"
          aria-label="Choose linked note"
          className="absolute left-0 top-full z-(--z-menu) mt-1 flex min-w-56 flex-col rounded-lg border border-border bg-popover p-1 text-sm shadow-lg"
        >
          {candidates.map((file) => (
            <button
              key={file.id}
              className="rounded px-3 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                setChoosing(false);
                workspace.follow(reference, sourceId, file.id);
              }}
            >
              {filePath(file, workspace.folders)}
            </button>
          ))}
          <button
            className="rounded px-3 py-2 text-left text-muted-foreground hover:bg-accent"
            onClick={() => setChoosing(false)}
          >
            Cancel
          </button>
        </span>
      )}
    </span>
  );
}
