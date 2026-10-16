import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { SETTINGS_SECTIONS } from "@/lib/app/routes";
export const Route = createFileRoute("/_app/settings/$section")({
  beforeLoad: ({ params }) => {
    if (!SETTINGS_SECTIONS.includes(params.section as (typeof SETTINGS_SECTIONS)[number]))
      throw redirect({ to: "/settings" });
  },
  component: Outlet,
});
