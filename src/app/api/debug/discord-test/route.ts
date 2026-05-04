import { NextRequest, NextResponse } from "next/server";
import { postTeamAlert } from "@/lib/discord";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await postTeamAlert(
    [
      {
        title: "🧪 Webhook smoke test",
        description: "If you see this, `DISCORD_TEAM_WEBHOOK_URL` is wired up correctly.",
        color: 0xe6c07a,
        timestamp: new Date().toISOString(),
        footer: { text: "EcomTalent · debug/discord-test" },
      },
    ],
    "Test from /api/debug/discord-test"
  );

  return NextResponse.json(result);
}
