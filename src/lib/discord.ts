/**
 * Discord delivery helpers.
 *
 * Two transports:
 *   - Webhook (channel-scoped) — used for team alerts to the
 *     team's #app-alerts channel. Requires DISCORD_TEAM_WEBHOOK_URL.
 *   - Bot DM (user-scoped) — used for the day-28 personal summary.
 *     Requires DISCORD_BOT_TOKEN and a Discord user_id. Falls back
 *     to a public webhook post if DM fails.
 *
 * All functions are best-effort: they swallow errors and log to
 * console so missing env vars or transient Discord 5xxs don't take
 * down a cron job.
 */

interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number; // RGB int (e.g. 0xff6b35)
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

const DEFAULT_GOLD = 0xe6c07a;

/**
 * Post a single embed to the team's webhook channel.
 * Pass multiple embeds at once (max 10 per message).
 */
export async function postTeamAlert(
  embeds: DiscordEmbed[],
  contentText?: string
): Promise<{ ok: boolean; status?: number; reason?: string }> {
  const url = process.env.DISCORD_TEAM_WEBHOOK_URL;
  if (!url) {
    console.warn(
      "[discord] DISCORD_TEAM_WEBHOOK_URL not set — skipping team alert"
    );
    return { ok: false, reason: "env-var-missing" };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: contentText,
        embeds: embeds.map((e) => ({
          color: e.color ?? DEFAULT_GOLD,
          ...e,
        })),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `[discord] webhook post failed (${res.status}): ${body.slice(0, 300)}`
      );
      return {
        ok: false,
        status: res.status,
        reason: `discord-${res.status}: ${body.slice(0, 200)}`,
      };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[discord] postTeamAlert failed:", err);
    return { ok: false, reason: `exception: ${message.slice(0, 200)}` };
  }
}

/**
 * Send a DM to a Discord user using the bot token.
 *
 * Two-step: open a DM channel, then post the embed.
 * Returns { ok: false } if either step fails — caller should fall
 * back to the public-channel webhook in that case.
 */
export async function dmStudent(
  discordUserId: string,
  embeds: DiscordEmbed[]
): Promise<{ ok: boolean; reason?: string }> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    return { ok: false, reason: "no-bot-token" };
  }
  try {
    // 1. Open DM channel (idempotent — Discord returns the same id)
    const channelRes = await fetch(
      "https://discord.com/api/v10/users/@me/channels",
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ recipient_id: discordUserId }),
      }
    );
    if (!channelRes.ok) {
      const txt = await channelRes.text();
      return {
        ok: false,
        reason: `dm-channel-${channelRes.status}: ${txt.slice(0, 200)}`,
      };
    }
    const channelData = await channelRes.json();
    const channelId = channelData.id as string;

    // 2. Post the embed to that DM channel
    const msgRes = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          embeds: embeds.map((e) => ({
            color: e.color ?? DEFAULT_GOLD,
            ...e,
          })),
        }),
      }
    );
    if (!msgRes.ok) {
      const txt = await msgRes.text();
      return {
        ok: false,
        reason: `dm-message-${msgRes.status}: ${txt.slice(0, 200)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    console.error("[discord] dmStudent failed:", err);
    return { ok: false, reason: "exception" };
  }
}

/**
 * Convenience helper for the team-alerts cron — formats a list of
 * disengagement alerts as a single Discord embed.
 */
export function buildAlertsEmbed(
  alerts: { studentName: string; alertType: string; message: string; studentId: string }[],
  baseUrl: string
): DiscordEmbed {
  return {
    title: `🚨 ${alerts.length} student${alerts.length === 1 ? "" : "s"} flagged`,
    description: alerts
      .map(
        (a) =>
          `**${a.studentName}** — ${labelForAlertType(a.alertType)}\n${a.message}\n[Open in admin](${baseUrl}/admin/students/${a.studentId})`
      )
      .join("\n\n"),
    color: 0xf05454,
    timestamp: new Date().toISOString(),
    footer: { text: "EcomTalent · check-engagement" },
  };
}

function labelForAlertType(t: string): string {
  switch (t) {
    case "no_lessons_3d":
      return "no lessons in 3 days";
    case "no_tasks_7d":
      return "no progress in 7 days";
    case "no_login_5d":
      return "hasn't logged in for 5+ days";
    case "no_activation_14d":
      return "hasn't activated by day 14";
    case "week2_no_start":
      return "hasn't started week 2";
    default:
      return t;
  }
}
