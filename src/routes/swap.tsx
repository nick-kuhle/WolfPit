import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /swap is now the Live desk of the trade page — send it there with the mode
 * preset. Kept as a route so every existing link (More sheet, desktop nav,
 * docs) keeps working; `beforeLoad` + `redirect` makes it a real redirect on
 * both the server (SSR) and the client.
 */
export const Route = createFileRoute("/swap")({
  beforeLoad: () => {
    throw redirect({ to: "/trade", search: { mode: "live" } });
  },
});
