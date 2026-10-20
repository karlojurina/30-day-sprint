"use client";

import { createClient } from "@/lib/supabase-browser";
import { loadBountyClaims, loadSnapshots, loadSprinters } from "@/lib/admin/insights-data";
import type { InsightsTransport } from "@/lib/admin/insights-data";

/** The Insights page's real reads (admin rebuild 2, WI-9), with the team member's client. */
export const insightsTransport: InsightsTransport = {
  loadSnapshots: (fromIso, toIso) => loadSnapshots(createClient(), fromIso, toIso),
  loadBountyClaims: () => loadBountyClaims(createClient()),
  loadSprinters: () => loadSprinters(createClient()),
};
