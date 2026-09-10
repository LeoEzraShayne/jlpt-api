import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type JlptLevel } from '@prisma/client';
import { ContentSelectionService } from '../content/content-selection.service';
import { suggestionUsesTargetGrammar } from '../ai/target-grammar';
import {
  chooseScenario,
  chooseTrainingMode,
  instructions,
} from './scenario-selection';
import { readTrainingContext, type TrainingContext } from './training-context';

@Injectable()
export class SceneService {
  private readonly logger = new Logger(SceneService.name);
  constructor(private readonly content: ContentSelectionService) {}

  async assign(
    tx: Prisma.TransactionClient,
    userId: string,
    sessionId: string,
    grammar: {
      id: string;
      level: JlptLevel;
      chineseExplanation: string;
      usageScene?: string | null;
    },
  ) {
    const history = await tx.studySession.findMany({
      where: { userId, grammarId: grammar.id, status: 'COMPLETED' },
      orderBy: [{ completedAt: 'desc' }, { id: 'asc' }],
      take: 40,
      select: { trainingContext: true },
    });
    const count = await tx.studySession.count({
      where: { userId, grammarId: grammar.id, status: 'COMPLETED' },
    });
    const mode = chooseTrainingMode(count);
    const scenarios = await tx.trainingScenario.findMany({
      where: {
        active: true,
        version: 'scenario-v1',
        levels: { has: grammar.level },
      },
      orderBy: { id: 'asc' },
    });
    const selected = chooseScenario(scenarios, history, mode, grammar);
    const context: TrainingContext = {
      version: 'training-v1',
      instructionZh: instructions[mode],
      scenario: selected
        ? {
            version: 'scenario-v1',
            id: selected.id,
            scenarioId: selected.id,
            taskId: `${selected.version}:${selected.id}:${selected.objective}`,
            objectiveId: selected.objective,
            domain: selected.domain,
            objective: selected.objective,
            register: selected.register,
            promptZh: selected.promptZh,
          }
        : null,
      words: [],
      supportingGrammar: null,
      expressions: [],
      phrases: [],
    };
    try {
      const material = await this.content.selectForPractice(
        userId,
        grammar.id,
        grammar.level,
        sessionId,
      );
      context.words = material.words.slice(0, 2).map((w) => ({
        id: w.id,
        word: w.word,
        reading: w.reading,
        chineseGloss: w.chineseGloss,
        glosses: w.glosses,
        sourceName: w.sourceName,
        sourceVersion: w.sourceVersion,
      }));
      context.expressions = material.expressions.slice(0, 3).map((e) => ({
        id: e.id,
        sentence: e.sentence,
        furigana: e.furigana,
        translationZh: e.translationZh,
        provenance: e.provenance,
      }));
      context.phrases = material.phrases.slice(0, 3).map((p) => ({
        id: p.id,
        word: p.word,
        reading: p.reading,
        payload: p.payload,
      }));
      if (mode === 'COMBINE' || mode === 'TRANSFER') {
        const support = await tx.userGrammarProgress.findFirst({
          where: {
            userId,
            grammarId: { not: grammar.id },
            lastStudiedAt: { not: null },
            status: { in: ['LEARNING', 'DUE', 'MASTERED', 'NEEDS_WORK'] },
            grammar: { status: 'PUBLISHED', level: { in: ['N2', 'N3', 'N4'] } },
          },
          orderBy: [{ status: 'asc' }, { lastStudiedAt: 'asc' }],
          include: {
            grammar: { select: { id: true, title: true, level: true } },
          },
        });
        context.supportingGrammar = support?.grammar ?? null;
      }
    } catch {
      this.logger.warn(
        'Supplementary content unavailable; preserving base grammar training',
      );
    }
    return {
      scenarioId: selected?.id ?? null,
      trainingMode: mode,
      trainingContext: context as Prisma.InputJsonValue,
    };
  }

  async recordShown(
    userId: string,
    sessionId: string,
    contextValue: unknown,
    includeReferences: boolean,
  ) {
    const context = readTrainingContext(contextValue);
    if (!context) return;
    const records: {
      type: 'VOCABULARY' | 'GRAMMAR' | 'EXPRESSION' | 'PHRASE';
      id: string;
    }[] = [
      ...context.words.map((w) => ({ type: 'VOCABULARY' as const, id: w.id })),
      ...(context.supportingGrammar
        ? [{ type: 'GRAMMAR' as const, id: context.supportingGrammar.id }]
        : []),
      ...(includeReferences
        ? context.expressions.map((e) => ({
            type: 'EXPRESSION' as const,
            id: e.id,
          }))
        : []),
      ...(includeReferences
        ? context.phrases.map((p) => ({ type: 'PHRASE' as const, id: p.id }))
        : []),
    ];
    await Promise.all(
      records.map((r) =>
        this.record(userId, sessionId, r.type, r.id, 'EXPOSED'),
      ),
    );
  }

  async recordUsed(
    userId: string,
    sessionId: string,
    contextValue: unknown,
    sentence: string,
    alternative: string,
  ) {
    const context = readTrainingContext(contextValue);
    if (!context) return;
    // Match only the selected lexical form, never propagate the sentence's score.
    for (const w of context.words) {
      if (sentence.includes(w.word))
        await this.record(userId, sessionId, 'VOCABULARY', w.id, 'USED');
      if (alternative.includes(w.word))
        await this.record(userId, sessionId, 'VOCABULARY', w.id, 'EXPOSED');
    }
    const g = context.supportingGrammar;
    if (g) {
      if (hasGrammarEvidence(g.title, sentence))
        await this.record(userId, sessionId, 'GRAMMAR', g.id, 'USED');
      if (hasGrammarEvidence(g.title, alternative))
        await this.record(userId, sessionId, 'GRAMMAR', g.id, 'EXPOSED');
    }
  }

  private async record(
    userId: string,
    sessionId: string,
    type: 'VOCABULARY' | 'GRAMMAR' | 'EXPRESSION' | 'PHRASE',
    id: string,
    interaction: 'EXPOSED' | 'USED',
  ) {
    try {
      await this.content.recordExposure(
        userId,
        sessionId,
        type,
        id,
        interaction,
      );
    } catch {
      this.logger.warn('Optional content exposure could not be recorded');
    }
  }
}

// The target guard intentionally allows unrecognizable labels; exposure evidence
// must instead abstain when no observable Japanese fragment can be extracted.
function hasGrammarEvidence(title: string, sentence: string) {
  const fragments = title
    .normalize('NFKC')
    .replace(/[（(][^）)]*[）)]/g, '')
    .split(/[～〜~・／/]/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length >= 2 &&
        /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s) &&
        !/[A-Za-z]/.test(s),
    );
  return (
    fragments.some((s) => sentence.includes(s)) &&
    suggestionUsesTargetGrammar(title, sentence)
  );
}
