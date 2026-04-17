import type { HiddenReward } from "@/types/database";

/**
 * Student state snapshot used for evaluating reward triggers.
 */
export interface RewardEvalState {
  completedTaskCount: number;
  currentStreak: number;
  longestStreak: number;
  completedTaskIds: Set<string>;
  notesWrittenCount: number;
  quizzesPassed: number;
  bestQuizScore: number; // percent, 0-100
}

/**
 * Evaluate which rewards should be unlocked given the student's current state.
 * Returns rewards that are newly unlockable (not yet in existingUnlockIds).
 */
export function evaluateRewards(
  allRewards: HiddenReward[],
  state: RewardEvalState,
  existingUnlockIds: Set<string>
): HiddenReward[] {
  const newlyUnlocked: HiddenReward[] = [];

  for (const reward of allRewards) {
    if (existingUnlockIds.has(reward.id)) continue;

    const triggered = checkTrigger(reward, state);
    if (triggered) {
      newlyUnlocked.push(reward);
    }
  }

  return newlyUnlocked;
}

function checkTrigger(reward: HiddenReward, state: RewardEvalState): boolean {
  const val = reward.trigger_value as Record<string, unknown>;

  switch (reward.trigger_type) {
    case "task_count":
      return state.completedTaskCount >= (val.count as number);

    case "streak_length":
      return state.currentStreak >= (val.streak as number);

    case "specific_task":
      return state.completedTaskIds.has(val.task_id as string);

    case "quiz_perfect":
      return state.bestQuizScore >= 100;

    case "notes_count":
      return state.notesWrittenCount >= (val.count as number);

    case "speed_bonus": {
      // Not evaluable client-side without join date context — handled server-side
      return false;
    }

    default:
      return false;
  }
}
