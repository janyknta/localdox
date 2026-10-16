import { createFileRoute, Outlet } from "@tanstack/react-router";
import { DocsApp } from "@/components/docs/DocsApp";

// One mounted workspace owns persistence and drafts across every app destination.
export const Route = createFileRoute("/_app")({
  component: () => (
    <>
      <DocsApp />
      <Outlet />
    </>
  ),
});
