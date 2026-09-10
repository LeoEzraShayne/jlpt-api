import { readFile, rename, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { z } from 'zod';

const BATCH_SIZE = 20;
const AUDIT_FILE = 'data/connection-rule-audit.json';
const candidateSchema = z.object({
  id: z.string().min(1),
  connectionRule: z.string().min(2).max(800),
  confidence: z.coerce.number().int().min(0).max(100).default(80),
  note: z.string().max(500).default(''),
});
const responseSchema = z.object({ items: z.array(candidateSchema) });

type GrammarRow = {
  id: string;
  level: string;
  title: string;
  chineseExplanation: string;
  currentRule: string | null;
  example: string | null;
};
type Candidate = z.infer<typeof candidateSchema>;
type AuditRow = GrammarRow & {
  gemini: Candidate;
  deepseek: Candidate;
  judge: Candidate;
  verifier: Candidate;
  finalRule: string;
  confidence: number;
  status: 'CONSENSUS' | 'ARBITRATED';
};
type Audit = {
  generatedAt: string;
  geminiModel: string;
  deepseekModel: string;
  total: number;
  rows: AuditRow[];
};

const outputJsonSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          connectionRule: { type: 'string' },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
          note: { type: 'string' },
        },
        required: ['id', 'connectionRule', 'confidence', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

async function main() {
  const databaseUrl = requiredEnv('DATABASE_URL');
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const grammar = await loadGrammar(pool);
    if (process.argv.includes('--apply')) {
      await applyAudit(pool, grammar);
      return;
    }
    await generateAudit(grammar);
  } finally {
    await pool.end();
  }
}

async function loadGrammar(pool: Pool) {
  const result = await pool.query<GrammarRow>(`
    SELECT g.id, g.level::text AS level, g.title,
      g."chineseExplanation", g."connectionRule" AS "currentRule",
      (SELECT e.sentence FROM "GrammarExample" e
       WHERE e."grammarId" = g.id ORDER BY e."sortOrder" LIMIT 1) AS example
    FROM "GrammarPoint" g
    WHERE g.status = 'PUBLISHED'
    ORDER BY g.level, g."sortOrder"`);
  return result.rows;
}

async function generateAudit(grammar: GrammarRow[]) {
  const geminiModel = connectionGeminiModel();
  const deepseekModel = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
  const audit = await readAudit().catch((): Audit => ({
    generatedAt: new Date().toISOString(),
    geminiModel,
    deepseekModel,
    total: grammar.length,
    rows: [],
  }));
  const completed = new Set(audit.rows.map((row) => row.id));
  if (!audit.geminiModel.split(',').includes(geminiModel))
    audit.geminiModel = `${audit.geminiModel},${geminiModel}`;
  const pending = grammar.filter((row) => !completed.has(row.id));
  for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
    const batch = pending.slice(offset, offset + BATCH_SIZE);
    const input = compactInput(batch);
    const [gemini, deepseek] = await Promise.all([
      callGemini(basePrompt('独立审校员 A', input)),
      callDeepSeek(basePrompt('独立审校员 B', input)),
    ]);
    assertIds(batch, gemini);
    assertIds(batch, deepseek);
    const judge = await callGemini(judgePrompt(batch, gemini, deepseek));
    assertIds(batch, judge);
    const verifier = await callDeepSeek(
      verifierPrompt(batch, gemini, deepseek, judge),
    );
    assertIds(batch, verifier);
    const rows = batch.map((row) =>
      buildAuditRow(row, gemini, deepseek, judge, verifier),
    );
    audit.rows.push(...rows);
    audit.generatedAt = new Date().toISOString();
    await writeAudit(audit);
    process.stdout.write(`audited ${audit.rows.length}/${grammar.length}\n`);
    await delay(5_000);
  }
  validateAudit(audit, grammar);
  process.stdout.write(
    `Audit complete: ${audit.rows.length} rules in ${AUDIT_FILE}\n`,
  );
}

function basePrompt(role: string, rows: ReturnType<typeof compactInput>) {
  return `${role}：请独立为下列 JLPT 语法确定最标准、完整的日语接续方式。
规则：
1. 只依据标准现代日语语法判断，不推测中文解释中的省略号。
2. 必须覆盖动词、イ形容词、ナ形容词、名词等实际可用形态；不适用的词类不要硬加。
3. 统一写法示例：动词普通形＋こと；ナ形容词词干＋な＋こと；名词＋の＋こと。多个形式用全角分号分隔。
4. 明确过去式、否定式、ます形、て形、词干等限制；规则本身不要重复语法含义。
5. currentRule 只作参考，可能为空或错误；例句只作佐证。
6. 每个 id 必须返回且只返回一次。note 用中文简述判断依据，不超过 80 字。
返回严格 JSON：{"items":[{"id":"...","connectionRule":"...","confidence":0-100,"note":"..."}]}
资料：${JSON.stringify(rows)}`;
}

function judgePrompt(
  rows: GrammarRow[],
  gemini: Candidate[],
  deepseek: Candidate[],
) {
  return `你是日语语法主编。对同一批 JLPT 语法，两个独立审校员给出了接续方式。逐条比较，选择更准确者或综合修正；不能按多数机械选择。重点检查普通形/辞书形、名词の/である、ナ形容词な/である、时态和否定限制。每个 id 必须输出最终候选。note 用中文说明分歧处理，不超过 80 字。严格返回 JSON items。
原始资料：${JSON.stringify(compactInput(rows))}
审校员A：${JSON.stringify(gemini)}
审校员B：${JSON.stringify(deepseek)}`;
}

function verifierPrompt(
  rows: GrammarRow[],
  gemini: Candidate[],
  deepseek: Candidate[],
  judge: Candidate[],
) {
  return `你是最终日语语法校对员。对照原始资料、两份独立意见和主编结果，逐条做最后校验。若主编结果准确则原样保留；若遗漏词类、助词或活用限制则直接修正。所有 connectionRule 必须可直接展示给学习者，不能为空。每个 id 仅返回一次，note 用中文说明最终依据，不超过 80 字，严格返回 JSON items。
原始资料：${JSON.stringify(compactInput(rows))}
独立意见A：${JSON.stringify(gemini)}
独立意见B：${JSON.stringify(deepseek)}
主编结果：${JSON.stringify(judge)}`;
}

async function callGemini(prompt: string) {
  const key = requiredEnv('GEMINI_API_KEY');
  const model = connectionGeminiModel();
  const response = await requestJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: outputJsonSchema,
          thinkingConfig: { thinkingLevel: 'low' },
        },
      }),
    },
  );
  const envelope = z
    .object({
      candidates: z.array(
        z.object({
          content: z.object({ parts: z.array(z.object({ text: z.string() })) }),
        }),
      ),
    })
    .parse(response);
  return parseItems(envelope.candidates[0].content.parts[0].text);
}

async function callDeepSeek(prompt: string) {
  const response = await requestJson(
    'https://api.deepseek.com/chat/completions',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${requiredEnv('DEEPSEEK_API_KEY')}`,
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
    },
  );
  const envelope = z
    .object({
      choices: z.array(
        z.object({ message: z.object({ content: z.string() }) }),
      ),
    })
    .parse(response);
  return parseItems(envelope.choices[0].message.content);
}

async function requestJson(url: string, init: RequestInit) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const text = await response.text();
      if (!response.ok)
        throw new Error(`AI HTTP ${response.status}: ${text.slice(0, 300)}`);
      return JSON.parse(text) as unknown;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await delay(attempt * 15_000);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function compactInput(rows: GrammarRow[]) {
  return rows.map((row) => ({
    id: row.id,
    level: row.level,
    title: row.title,
    explanation: row.chineseExplanation,
    example: row.example,
    currentRule: row.currentRule,
  }));
}

function parseItems(text: string) {
  const clean = text.replace(/^```json\s*|\s*```$/g, '');
  return responseSchema.parse(JSON.parse(clean) as unknown).items;
}

function assertIds(rows: GrammarRow[], candidates: Candidate[]) {
  const expected = [...rows.map((row) => row.id)].sort();
  const actual = [...candidates.map((item) => item.id)].sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    throw new Error(
      'AI response ids did not match the requested grammar batch',
    );
}

function buildAuditRow(
  row: GrammarRow,
  geminiItems: Candidate[],
  deepseekItems: Candidate[],
  judgeItems: Candidate[],
  verifierItems: Candidate[],
): AuditRow {
  const find = (items: Candidate[]) =>
    items.find((item) => item.id === row.id)!;
  const gemini = find(geminiItems);
  const deepseek = find(deepseekItems);
  const judge = find(judgeItems);
  const verifier = find(verifierItems);
  return {
    ...row,
    gemini,
    deepseek,
    judge,
    verifier,
    finalRule: verifier.connectionRule.trim(),
    confidence: Math.min(judge.confidence, verifier.confidence),
    status:
      normalize(gemini.connectionRule) === normalize(deepseek.connectionRule)
        ? 'CONSENSUS'
        : 'ARBITRATED',
  };
}

async function applyAudit(pool: Pool, grammar: GrammarRow[]) {
  const audit = await readAudit();
  validateAudit(audit, grammar);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of audit.rows)
      await client.query(
        'UPDATE "GrammarPoint" SET "connectionRule" = $1, "updatedAt" = NOW() WHERE id = $2',
        [row.finalRule, row.id],
      );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  process.stdout.write(
    `Applied ${audit.rows.length} reviewed connection rules.\n`,
  );
}

function validateAudit(audit: Audit, grammar: GrammarRow[]) {
  const ids = new Set(grammar.map((row) => row.id));
  if (
    audit.rows.length !== grammar.length ||
    new Set(audit.rows.map((row) => row.id)).size !== grammar.length
  )
    throw new Error(
      `Audit must contain exactly ${grammar.length} unique rules`,
    );
  for (const row of audit.rows) {
    if (!ids.has(row.id) || row.finalRule.trim().length < 2)
      throw new Error(`Invalid audited rule for ${row.id}`);
  }
}

async function readAudit() {
  return JSON.parse(await readFile(AUDIT_FILE, 'utf8')) as Audit;
}

async function writeAudit(audit: Audit) {
  const temporary = `${AUDIT_FILE}.tmp`;
  await writeFile(temporary, `${JSON.stringify(audit, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, AUDIT_FILE);
}

function normalize(value: string) {
  return value.replace(/[\s・；;、，]/g, '').toLowerCase();
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function connectionGeminiModel() {
  return process.env.CONNECTION_GEMINI_MODEL ?? 'gemini-3.5-flash-lite';
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
