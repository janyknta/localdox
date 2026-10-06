import { useEffect, useState } from "react";
import type { MdFile } from "@/lib/markdown/markdown-utils";

/**
 * A counter that moves when a file an embed resolved to has been replaced in
 * the workspace's file list — edited, renamed, moved or binned.
 *
 * An embed resolves its reference against the whole file list, but every
 * autosave rebuilds that list. Re-resolving whenever it changed meant every
 * embed in every open document was re-resolved on each pause in typing, got a
 * fresh object URL, and reloaded its image or restarted its player. So an embed
 * re-resolves on `fileSetRevision` (which files exist, and where) plus this:
 * only when its own answer could have changed.
 *
 * `resolved` holds records taken from `files` — never ones read from another
 * workspace, which are never in it — and must keep its identity between
 * renders, or the check runs on every render.
 */
export function useResolvedFileRefresh(
  files: readonly MdFile[] | undefined,
  resolved: readonly MdFile[],
) {
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (files && resolved.some((file) => !files.includes(file))) setRefresh((n) => n + 1);
  }, [files, resolved]);
  return refresh;
}
