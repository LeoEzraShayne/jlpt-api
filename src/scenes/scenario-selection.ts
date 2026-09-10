import type { TrainingScenario } from '@prisma/client';
import { readScenarioContext } from '../study-sessions/review-evidence';

export type TrainingMode = 'UNDERSTAND' | 'SUBSTITUTE' | 'COMBINE' | 'TRANSFER';
export const instructions: Record<TrainingMode, string> = {
  UNDERSTAND: '先理解参考表达的意思，再用目标语法表达与自己有关的事情。',
  SUBSTITUTE: '保留熟悉的表达结构，替换人物、内容或时间，确保意思自然。',
  COMBINE: '把熟悉的表达与一个已有表达组合，完成场景任务；不必追求长句。',
  TRANSFER:
    '先不看参考表达，用目标语法独立完成新的表达任务；只换名词不算迁移。',
};
export function chooseTrainingMode(completedCount: number): TrainingMode {
  if (!completedCount) return 'UNDERSTAND';
  if (completedCount < 3) return 'SUBSTITUTE';
  if (completedCount === 3) return 'COMBINE';
  return completedCount % 3 === 0 ? 'COMBINE' : 'TRANSFER';
}
export function chooseScenario(
  scenarios: TrainingScenario[],
  history: { trainingContext: unknown }[],
  mode: TrainingMode,
  grammar: {
    level: string;
    usageScene?: string | null;
    chineseExplanation: string;
  },
) {
  const previous = history
    .map((row) => readScenarioContext(row.trainingContext))
    .filter((row) => row !== null);
  const last = previous[0];
  if (mode === 'SUBSTITUTE' || mode === 'COMBINE') {
    const same = scenarios.find((row) => row.id === last?.scenarioId);
    if (same) return same;
  }
  const registerText = `${grammar.usageScene ?? ''} ${grammar.chineseExplanation}`;
  const written = /书面|正式|論説|論文|文章体/.test(registerText);
  const casual = /口语|口頭|日常会话|口語/.test(registerText);
  let candidates = scenarios.filter((row) =>
    written
      ? row.register !== 'CASUAL'
      : casual
        ? row.register !== 'FORMAL_WRITTEN'
        : true,
  );
  if (mode === 'TRANSFER' && last) {
    candidates = candidates.filter(
      (row) => row.id !== last.scenarioId && row.objective !== last.objectiveId,
    );
  }
  // If no compatible new task exists, do not fabricate transfer evidence.
  if (!candidates.length) return null;
  const used = new Set(previous.map((row) => row.scenarioId));
  return (
    candidates.find((row) => !used.has(row.id)) ??
    candidates[history.length % candidates.length]
  );
}
