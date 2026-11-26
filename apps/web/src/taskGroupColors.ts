import { TaskGroupColor } from "@t3tools/contracts";
import { msg } from "gt-react";

export interface TaskGroupColorClasses {
  readonly label: string;
  /** The tinted title chip. */
  readonly chip: string;
  /** The rail beside member rows and the dot of a closed or archived group. */
  readonly accent: string;
}

const COLORS: Record<TaskGroupColor, TaskGroupColorClasses> = {
  slate: {
    label: msg("Gray", { $context: "colour name, project icon colour" }),
    chip: "bg-slate-500/14 text-slate-700 dark:bg-slate-400/16 dark:text-slate-200",
    accent: "bg-slate-400 dark:bg-slate-400/80",
  },
  blue: {
    label: msg("Blue", { $context: "colour name, project icon colour" }),
    chip: "bg-blue-500/14 text-blue-700 dark:bg-blue-400/18 dark:text-blue-200",
    accent: "bg-blue-500 dark:bg-blue-400/85",
  },
  cyan: {
    label: msg("Cyan", { $context: "colour name, project icon colour" }),
    chip: "bg-cyan-500/14 text-cyan-800 dark:bg-cyan-400/18 dark:text-cyan-200",
    accent: "bg-cyan-500 dark:bg-cyan-400/85",
  },
  green: {
    label: msg("Green", { $context: "colour name, project icon colour" }),
    chip: "bg-green-500/14 text-green-800 dark:bg-green-400/18 dark:text-green-200",
    accent: "bg-green-500 dark:bg-green-400/85",
  },
  amber: {
    label: msg("Yellow", { $context: "colour name, project icon colour" }),
    chip: "bg-amber-500/16 text-amber-800 dark:bg-amber-400/18 dark:text-amber-200",
    accent: "bg-amber-500 dark:bg-amber-400/85",
  },
  orange: {
    label: msg("Orange", { $context: "colour name, project icon colour" }),
    chip: "bg-orange-500/14 text-orange-800 dark:bg-orange-400/18 dark:text-orange-200",
    accent: "bg-orange-500 dark:bg-orange-400/85",
  },
  pink: {
    label: msg("Pink", { $context: "colour name, project icon colour" }),
    chip: "bg-pink-500/14 text-pink-700 dark:bg-pink-400/18 dark:text-pink-200",
    accent: "bg-pink-500 dark:bg-pink-400/85",
  },
  purple: {
    label: msg("Purple", { $context: "colour name, project icon colour" }),
    chip: "bg-purple-500/14 text-purple-700 dark:bg-purple-400/18 dark:text-purple-200",
    accent: "bg-purple-500 dark:bg-purple-400/85",
  },
};

export const TASK_GROUP_COLORS: ReadonlyArray<TaskGroupColor> = TaskGroupColor.literals;

export function taskGroupColorClasses(color: TaskGroupColor): TaskGroupColorClasses {
  return COLORS[color];
}

/** Like Chrome's tab groups, a new group takes the first colour its environment is not using. */
export function nextTaskGroupColor(used: Iterable<TaskGroupColor>): TaskGroupColor {
  const counts = new Map<TaskGroupColor, number>();
  for (const color of used) counts.set(color, (counts.get(color) ?? 0) + 1);
  const palette = TASK_GROUP_COLORS.filter((color) => color !== "slate");
  let best = palette[0] ?? "blue";
  for (const color of palette) {
    if ((counts.get(color) ?? 0) < (counts.get(best) ?? 0)) best = color;
  }
  return best;
}
