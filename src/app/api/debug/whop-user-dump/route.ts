import { NextRequest, NextResponse } from "next/server";

/**
 * Temporary probe — hits multiple Whop endpoints with the admin key
 * and dumps everything they return for one user. We use this to see
 * whether Discord user ID is exposed on any of them.
 *
 * Usage:
 *   curl "https://YOUR-DOMAIN/api/debug/whop-user-dump?whop_user_id=user_XXXX" \
 *     -H "Authorization: Bearer $CRON_SECRET"
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const whopUserId = url.searchParams.get("whop_user_id");
  if (!whopUserId) {
    return NextResponse.json(
      { error: "Pass ?whop_user_id=user_XXXX" },
      { status: 400 }
    );
  }

  const apiKey = process.env.WHOP_API_KEY;
  const companyId = process.env.WHOP_COMPANY_ID;
  if (!apiKey) {
    return NextResponse.json(
      { error: "WHOP_API_KEY missing" },
      { status: 500 }
    );
  }

  const headers = { Authorization: `Bearer ${apiKey}` };

  const probes: Record<string, string> = {
    member_v2_singular: `https://api.whop.com/api/v2/members/${whopUserId}`,
    user_social_accounts: `https://api.whop.com/api/v2/users/${whopUserId}/social_accounts`,
    members_v2_filter_email: `https://api.whop.com/api/v2/members?email=charlieyard109@gmail.com`,
    members_v2_filter_username: `https://api.whop.com/api/v2/members?username=charlieyard109`,
    members_v2_filter_search: `https://api.whop.com/api/v2/members?search=charlieyard109`,
    members_v2_per100: `https://api.whop.com/api/v2/members?per=100`,
  };

  const results: Record<string, unknown> = {};
  await Promise.all(
    Object.entries(probes).map(async ([key, probeUrl]) => {
      try {
        const res = await fetch(probeUrl, { headers });
        const text = await res.text();
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          /* keep as text */
        }
        results[key] = { status: res.status, url: probeUrl, body };
      } catch (err) {
        results[key] = {
          error: err instanceof Error ? err.message : String(err),
          url: probeUrl,
        };
      }
    })
  );

  return NextResponse.json(results);
}
