export const SETTINGS_SECTIONS = [
  "appearance",
  "reading",
  "diagrams",
  "math",
  "ai",
  "workspace",
  "exams",
  "practice",
  "storage",
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export function settingsPath(section: SettingsSection = "appearance", itemId?: string) {
  return `/settings/${section}${(section === "exams" || section === "practice") && itemId ? `/${encodeURIComponent(itemId)}` : ""}`;
}

export function workspacePath(workspaceId: string, fileId?: string | null) {
  const base = `/workspaces/${encodeURIComponent(workspaceId)}`;
  return fileId ? `${base}/files/${encodeURIComponent(fileId)}` : base;
}

export function readAppRoute(pathname: string) {
  const parts = pathname
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
  const settings = parts[0] === "settings";
  return {
    settings,
    section: SETTINGS_SECTIONS.includes(parts[1] as SettingsSection)
      ? (parts[1] as SettingsSection)
      : ("appearance" as SettingsSection),
    rulesId: settings && parts[1] === "exams" ? parts[2] : undefined,
    practiceId: settings && parts[1] === "practice" ? parts[2] : undefined,
    workspaceId: parts[0] === "workspaces" ? parts[1] : undefined,
    fileId: parts[0] === "workspaces" && parts[2] === "files" ? parts[3] : undefined,
  };
}
