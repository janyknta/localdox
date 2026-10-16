import { createContext } from "react";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import type { FolderRecord } from "@/lib/workspace/persistence";
import type { IndexedNoteLink } from "@/lib/markdown/note-links";

export const WorkspaceLinksContext = createContext<{
  files: MdFile[];
  folders: FolderRecord[];
  links: IndexedNoteLink[];
  follow: (reference: string, sourceId: string, chosenId?: string) => void;
} | null>(null);
