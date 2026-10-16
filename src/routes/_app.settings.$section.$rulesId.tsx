import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/_app/settings/$section/$rulesId")({
  beforeLoad: ({ params }) => {
    if (params.section !== "exams" && params.section !== "practice")
      throw redirect({ to: "/settings/$section", params: { section: params.section } });
  },
  component: () => null,
});
