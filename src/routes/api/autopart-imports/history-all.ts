import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/autopart-imports/history-all")({
  server: {
    handlers: {
      POST: async () =>
        Response.json(
          {
            ok: false,
            error:
              "Historical 561L-ALL and SLRB-ALL imports are retired. Active trade customers are linked from the 407EXP master. Ongoing sales use 504 and TRM21QC.",
          },
          { status: 410 },
        ),
    },
  },
});
