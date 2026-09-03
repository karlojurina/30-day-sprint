"use client";

import { useEffect } from "react";
import { AdminPage, PageHeader, Card, Button, Pill, T } from "@/components/admin/ui";

/**
 * Route error boundary for the whole admin area.
 *
 * WHY THIS EXISTS: before v86 there was NO error boundary anywhere in this
 * application — `find src -name "error.tsx" -o -name "global-error.tsx"`
 * returned nothing, and there was no componentDidCatch either. So a throw
 * inside any admin client component unmounted the entire tree and left a
 * blank white page with no message, no reload affordance, and nothing in the
 * UI to say what happened.
 *
 * Added alongside the Stats page (which parses JSON from an external API and
 * renders stored layout JSON), but it protects all 18 admin pages equally and
 * is worth having regardless of that feature.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Vercel captures console.error server-side; this is the only breadcrumb
    // that survives a client crash.
    console.error("[admin] render error", error);
  }, [error]);

  return (
    <AdminPage>
      <PageHeader
        title="Something broke on this page"
        description="The rest of the admin area is unaffected — this page failed to render."
      />
      <Card padding={16}>
        <div className="flex items-center" style={{ gap: 10, marginBottom: 12 }}>
          <Pill tone="danger">render error</Pill>
          {error.digest && (
            <span style={T.meta}>reference {error.digest}</span>
          )}
        </div>
        <p style={{ ...T.bodyDim, marginBottom: 16 }}>
          {/* error.message is a client-side React error, not an upstream API
              body, so it is safe to show and is the only clue available. */}
          {error.message || "No message was reported."}
        </p>
        <div className="flex items-center" style={{ gap: 8 }}>
          <Button onClick={reset}>Try again</Button>
          <Button onClick={() => (window.location.href = "/admin")}>
            Back to dashboard
          </Button>
        </div>
      </Card>
    </AdminPage>
  );
}
