import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import type {
  WhopWebhookPayload,
  WhopMembership,
  WhopLessonInteractionWebhookData,
} from "@/types/whop";
import { createHmac } from "crypto";

function verifyWebhookSignature(
  body: string,
  signature: string | null
): boolean {
  if (!signature || !process.env.WHOP_WEBHOOK_SECRET) return false;

  const expected = createHmac("sha256", process.env.WHOP_WEBHOOK_SECRET)
    .update(body)
    .digest("hex");

  return signature === expected;
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("x-whop-signature");

  // Verify webhook signature
  if (!verifyWebhookSignature(body, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: WhopWebhookPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = createServiceClient();

  switch (payload.event) {
    case "membership.activated":
    case "membership.went_valid": {
      const membership = payload.data as WhopMembership;
      const { error } = await supabase.from("students").upsert(
        {
          whop_user_id: membership.user.id,
          whop_membership_id: membership.id,
          email: membership.user.email,
          name: membership.user.name,
          discord_username: membership.user.username,
          membership_status: "active",
          joined_at: membership.joined_at || new Date().toISOString(),
        },
        { onConflict: "whop_user_id" }
      );

      if (error) {
        console.error("Webhook: student upsert failed:", error);
        return NextResponse.json(
          { error: "Database error" },
          { status: 500 }
        );
      }
      break;
    }

    case "membership.deactivated":
    case "membership.went_invalid": {
      const membership = payload.data as WhopMembership;
      const { error } = await supabase
        .from("students")
        .update({ membership_status: "canceled" })
        .eq("whop_user_id", membership.user.id);

      if (error) {
        console.error("Webhook: student update failed:", error);
      }
      break;
    }

    case "payment.succeeded": {
      const membership = payload.data as WhopMembership;
      const { error } = await supabase
        .from("students")
        .update({ membership_status: "active" })
        .eq("whop_user_id", membership.user.id);

      if (error) {
        console.error("Webhook: payment update failed:", error);
      }
      break;
    }

    case "course_lesson_interaction.completed": {
      // Student finished a Whop course lesson — mark the matching task
      // complete in our DB. Idempotent via unique(student_id, task_id).
      const data = payload.data as WhopLessonInteractionWebhookData;
      const whopUserId = data.user?.id;
      const lessonId = data.lesson?.id ?? data.lesson_id;

      if (!whopUserId || !lessonId) {
        console.warn("Webhook: lesson.completed missing user or lesson id", data);
        break;
      }

      // Look up the student
      const { data: student } = await supabase
        .from("students")
        .select("id")
        .eq("whop_user_id", whopUserId)
        .single();
      if (!student) {
        console.warn(
          `Webhook: lesson.completed for unknown student ${whopUserId}`
        );
        break;
      }

      // Look up the task matching this lesson
      const { data: task } = await supabase
        .from("tasks")
        .select("id")
        .eq("whop_lesson_id", lessonId)
        .single();
      if (!task) {
        // No task is mapped to this lesson — nothing to do
        break;
      }

      const { error } = await supabase
        .from("student_task_completions")
        .upsert(
          { student_id: student.id, task_id: task.id },
          {
            onConflict: "student_id,task_id",
            ignoreDuplicates: true,
          }
        );

      if (error) {
        console.error("Webhook: lesson completion upsert failed:", error);
      }
      break;
    }

    default:
      // Unknown event, acknowledge anyway
      break;
  }

  return NextResponse.json({ received: true });
}
