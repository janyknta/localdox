import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/_app/workspaces/$workspaceId/files/$fileId")({
  component: () => null,
});
