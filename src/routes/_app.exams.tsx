import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/_app/exams")({
  head: () => ({ meta: [{ title: "Localdox" }] }),
  component: () => null,
});
