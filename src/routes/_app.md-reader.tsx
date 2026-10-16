import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/md-reader")({
  head: () => ({
    meta: [{ title: "Markdown Reader" }],
  }),
  component: () => null,
});
