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

/** Discord refuses an embed whose description is longer than this. */
export const EMBED_DESCRIPTION_MAX = 4096;

/** How many times a post Discord answered 429 is sent again. */
const RATE_LIMIT_RETRIES = 2;

/** How long to wait after a 429: Discord's Retry-After (seconds), at most 10 s. */
function retryAfterMs(res: Response): number {
  const seconds = Number.parseFloat(res.headers.get("retry-after") ?? "");
  return Math.min(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 2000, 10_000);
}

/**
 * Post a single embed to the team's webhook channel.
 * Pass multiple embeds at once (max 10 per message).
 *
 * Discord answers 429 when a webhook posts faster than it takes, with
 * Retry-After in seconds. The post waits that long and is sent again, at
 * most twice: the engagement alerts go out as several messages in a row.
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
    const body = JSON.stringify({
      content: contentText,
      embeds: embeds.map((e) => ({
        color: e.color ?? DEFAULT_GOLD,
        ...e,
      })),
    });
    let res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    for (let retry = 0; res.status === 429 && retry < RATE_LIMIT_RETRIES; retry++) {
      await res.text().catch(() => "");
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs(res)));
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    }
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
 * Convenience helper for the team-alerts cron: the disengagement alerts
 * as Discord embeds, in order, each alert in exactly one embed, and each
 * embed's description within Discord's 4096 characters (one embed held
 * every alert until 20 October, and Discord refused it from about 22
 * alerts on). Post each embed as its own message: a full description with
 * its title and footer stays under Discord's 6000 characters a message.
 */
export function buildAlertsEmbeds(
  alerts: { studentName: string; alertType: string; message: string; studentId: string }[],
  baseUrl: string
): DiscordEmbed[] {
  const entries = alerts.map((a) => {
    const entry = `**${a.studentName}**: ${labelForAlertType(a.alertType)}\n${a.message}\n[Open in admin](${baseUrl}/admin/students/${a.studentId})`;
    if (entry.length <= EMBED_DESCRIPTION_MAX) return entry;
    // Only a name thousands of characters long gets here. Cut it to fit,
    // never through the middle of an emoji.
    let cut = entry.slice(0, EMBED_DESCRIPTION_MAX - 1);
    if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
    return `${cut}…`;
  });

  const chunks: string[][] = [];
  let length = 0;
  for (const entry of entries) {
    const chunk = chunks[chunks.length - 1];
    if (chunk && length + 2 + entry.length <= EMBED_DESCRIPTION_MAX) {
      chunk.push(entry);
      length += 2 + entry.length;
    } else {
      chunks.push([entry]);
      length = entry.length;
    }
  }

  const flagged = `🚨 ${alerts.length} student${alerts.length === 1 ? "" : "s"} flagged`;
  const timestamp = new Date().toISOString();
  return chunks.map((chunk, i) => ({
    title: chunks.length === 1 ? flagged : `${flagged} (part ${i + 1} of ${chunks.length})`,
    description: chunk.join("\n\n"),
    color: 0xf05454,
    timestamp,
    footer: { text: "Ecom University · check-engagement" },
  }));
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
