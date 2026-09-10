import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { MAX_GENERATED_QUESTIONS } from '../../shared/types';
import { describeGeminiError, isRetryable, retryDelayMs } from './gemini-error';

/**
 * 学習メモ・ノート本文・単一用語から一問一答を生成する。
 *
 * 呼び出し側の前提: この関数群は例外を投げない。失敗しても { questions: [], warning }
 * を返し、学習記録やノートの保存という主機能を AI 側の障害に巻き込ませない。
 *
 * **warning は「生成できなかった理由」だけを書く。** 元の入力が保存されたかどうかは
 * 呼び出し側の事情で、用語のクイック追加のように保存しない経路もある。
 * 保存された旨を添えたい経路は CONTENT_KEPT を自分で足す。
 */

export interface GeneratedQuestion {
  question: string;
  answer: string;
  explanation: string;
  /** ジャンルタグ。1〜3 個。 */
  tags: string[];
}

export interface GenerateQuizResult {
  questions: GeneratedQuestion[];
  warning?: string;
}

// gemini-2.5-flash は新規ユーザー向けの提供が終了しており、API 側が 3.6-flash を案内する。
// Gemini 3 系は thinkingBudget を受け付けず、thinkingLevel を使う（budget を渡すと 400）。
const MODEL = 'gemini-3.6-flash';
const MAX_TAGS_PER_QUESTION = 3;
const TIMEOUT_MS = 60_000;
/** 最初の 1 回を含めた試行回数。高負荷は数秒で解けることが多い */
const MAX_ATTEMPTS = 3;
/** 再試行の待ち時間。指数的に伸ばす */
const BACKOFF_MS = [1_000, 3_000];
/** 殺到したクライアントが同じ瞬間に再送しないよう散らす */
const JITTER_RATIO = 0.3;
/** 残り時間がこれを切ったら投げ直さない。締め切り直前の再試行は timeout に化けるだけ */
const MIN_ATTEMPT_BUDGET_MS = 8_000;

/** 生成は失敗したが、元の入力は保存されている経路で warning に足す */
export const CONTENT_KEPT = '内容は保存されています。';

/**
 * 次に待つ時間。投げ直さないなら null。
 *
 * サーバーが RetryInfo で待ち時間を指定してきたらそちらに従う。
 * ただし残り時間に収まらないなら諦める（待った末に timeout で落ちるより、
 * 混雑していると伝えて操作を返すほうがよい）。
 */
function nextDelayMs(error: unknown, attempt: number, remainingMs: number): number | null {
  if (!isRetryable(error)) return null;
  const base = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
  const jittered = Math.round(base * (1 + (Math.random() * 2 - 1) * JITTER_RATIO));
  const wait = retryDelayMs(error) ?? jittered;
  return wait + MIN_ATTEMPT_BUDGET_MS <= remainingMs ? wait : null;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          question: {
            type: Type.STRING,
            description: '用語の定義や役割を説明した問題文。答えの用語そのものは含めない。',
          },
          answer: { type: Type.STRING, description: '正解となる用語名のみ。短く。' },
          explanation: { type: Type.STRING, description: '100文字前後の簡潔な解説。' },
          tags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              'この問題が属する分野・ジャンルのタグを1〜3個。例: ネットワーク, セキュリティ, データベース',
          },
        },
        required: ['question', 'answer', 'explanation', 'tags'],
        propertyOrdering: ['question', 'answer', 'explanation', 'tags'],
      },
    },
  },
  required: ['questions'],
};

/** 全プロンプト共通の作問ルール */
function commonRules(maxQuestions: number): string {
  return `制約:
- question: その用語の定義・役割・特徴を説明する文にする。答えの用語そのものを問題文に含めてはいけない。
- answer: 正解となる用語名のみを**30文字以内**で短く書く。文章にしない。
- explanation: **100文字以内**で簡潔に解説する。冗長な言い換えや前置きを書かない。
- tags: その問題が属する分野・ジャンルのタグを1〜3個付与する（例: 'ネットワーク', 'セキュリティ', 'データベース'）。
  タグは一般的な分野名にし、問題文をそのまま繰り返さないこと。
- 入力に含まれない知識を持ち出さない。入力の内容に忠実に作る。
- 重要用語が${maxQuestions}個未満なら、無理に水増しせず少ない問数で構わない。
- 出力はすべて日本語で書く。`;
}

function buildStudyLogPrompt(notes: string, categoryName: string, maxQuestions: number): string {
  return `あなたは学習者の復習を支援する出題者です。
以下は学習者が「${categoryName}」の学習後に書いた学びのメモです。

--- 学習メモ ここから ---
${notes}
--- 学習メモ ここまで ---

このメモから、核となる重要用語を【最大${maxQuestions}問】選定して一問一答形式の問題を作成してください。

${commonRules(maxQuestions)}`;
}

function buildNotebookPrompt(
  title: string,
  content: string,
  categoryName: string,
  maxQuestions: number,
): string {
  return `あなたは学習者の復習を支援する出題者です。
以下は学習者が「${categoryName}」について書いた Markdown 形式の学習ノートです。

--- ノート「${title}」ここから ---
${content}
--- ノート ここまで ---

このノートから、核となる重要用語を【最大${maxQuestions}問】選定して一問一答形式の問題を作成してください。
見出しや箇条書きの記法そのものは問題にせず、内容から出題すること。

${commonRules(maxQuestions)}`;
}

function buildSingleTermPrompt(term: string, description: string, categoryName: string): string {
  return `あなたは学習者の復習を支援する出題者です。
「${categoryName}」の学習者が、次の用語を復習用に登録しようとしています。

用語: ${term}
説明: ${description}

この用語について、一問一答形式の問題を【ちょうど1問】作成してください。

${commonRules(1)}`;
}

/**
 * LLM 出力から JSON を取り出す。Structured Outputs 利用時でも、
 * 前後に余分なテキストやコードフェンスが混ざる事例があるため防御的に扱う。
 * 参照: Vault 20_ナレッジ/トラブルシューティング/gemini-json-parse-error.md
 */
function parseJsonSafely(text: string): unknown | null {
  const cleaned = text.trim().replace(/^﻿/, '');
  if (!cleaned) return null;

  const candidates: string[] = [cleaned];

  // ```json ... ``` のコードフェンスを剥がす
  const fenced = cleaned
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/, '')
    .trim();
  if (fenced !== cleaned) candidates.push(fenced);

  // 最初の { から最後の } までを直接抜き出す
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(cleaned.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // 次の候補へ
    }
  }
  return null;
}

/** タグを検証・正規化する。不正なら空配列に落とす。 */
function coerceTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const tag = item.trim();
    if (!tag) continue;
    seen.add(tag);
    if (seen.size >= MAX_TAGS_PER_QUESTION) break;
  }
  return [...seen];
}

/** パース結果を実行時に検証し、不正な要素は捨てる */
function coerceQuestions(parsed: unknown, maxQuestions: number): GeneratedQuestion[] {
  if (typeof parsed !== 'object' || parsed === null) return [];
  const rawList = (parsed as { questions?: unknown }).questions;
  if (!Array.isArray(rawList)) return [];

  const result: GeneratedQuestion[] = [];
  for (const raw of rawList) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const question = typeof item.question === 'string' ? item.question.trim() : '';
    const answer = typeof item.answer === 'string' ? item.answer.trim() : '';
    const explanation = typeof item.explanation === 'string' ? item.explanation.trim() : '';
    if (!question || !answer) continue;
    result.push({ question, answer, explanation, tags: coerceTags(item.tags) });
  }
  return result.slice(0, maxQuestions);
}

export function clampQuestionCount(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_GENERATED_QUESTIONS, Math.max(1, Math.trunc(parsed)));
}

interface JsonCallLabels {
  /** API キーが無いとき */
  missingKey: string;
  /** 応答は返ったが、使える中身を取り出せなかったとき */
  unusable: string;
}

/**
 * Gemini を JSON で 1 回叩く。**ここだけが例外を握りつぶす。**
 *
 * 再試行・締め切り・コードフェンス剥がしを 1 か所に集めてある。
 * スキーマと検証だけ差し替えれば、問題以外のもの（用語の意味など）も同じ堅さで取れる。
 */
async function callGeminiJson<T>(
  apiKey: string | undefined,
  prompt: string,
  responseSchema: unknown,
  /** 応答を検証して値にする。信用できなければ null を返す。 */
  coerce: (parsed: unknown) => T | null,
  labels: JsonCallLabels,
): Promise<{ value: T | null; warning?: string }> {
  if (!apiKey) return { value: null, warning: labels.missingKey };

  try {
    const ai = new GoogleGenAI({ apiKey });
    // 再試行を含めた操作全体で 1 つの期限にする。
    // 試行ごとに signal を作ると、待機を挟んだ 2 回目の期限が不安定になる。
    const deadline = AbortSignal.timeout(TIMEOUT_MS);
    const callOnce = () =>
      ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema,
          // MVP では応答速度を優先し、思考を最小限にする
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          temperature: 0.4,
          abortSignal: deadline,
        },
      });

    const startedAt = Date.now();
    let response: Awaited<ReturnType<typeof callOnce>>;
    for (let attempt = 0; ; attempt++) {
      try {
        response = await callOnce();
        break;
      } catch (error) {
        const remaining = TIMEOUT_MS - (Date.now() - startedAt);
        const wait = attempt < MAX_ATTEMPTS - 1 ? nextDelayMs(error, attempt, remaining) : null;
        if (wait === null) throw error;
        console.warn(`[gemini] retrying in ${wait}ms (${attempt + 1}/${MAX_ATTEMPTS - 1}):`, error);
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }

    const text = response.text;
    if (!text) return { value: null, warning: 'AI からの応答が空でした。' };

    const value = coerce(parseJsonSafely(text));
    if (value === null) return { value: null, warning: labels.unusable };
    return { value };
  } catch (error) {
    // 生の中身はここに残す。画面には出さないが、調べるときに要る。
    console.error('[gemini] generation failed:', error);
    return { value: null, warning: describeGeminiError(error) };
  }
}

/** 一問一答の生成。文言は切り出す前と 1 文字も変えていない。 */
async function callGemini(
  apiKey: string | undefined,
  prompt: string,
  maxQuestions: number,
): Promise<GenerateQuizResult> {
  const { value, warning } = await callGeminiJson(
    apiKey,
    prompt,
    RESPONSE_SCHEMA,
    (parsed) => {
      const questions = coerceQuestions(parsed, maxQuestions);
      return questions.length > 0 ? questions : null;
    },
    {
      missingKey: 'GEMINI_API_KEY が未設定のため問題を生成できませんでした。',
      unusable: 'AI の応答から問題を抽出できませんでした。入力に用語が少ない可能性があります。',
    },
  );

  return value ? { questions: value } : { questions: [], warning };
}

/** 学習メモから生成する */
export function generateQuizFromStudyLog(
  apiKey: string | undefined,
  notes: string,
  categoryName: string,
  maxQuestions: number,
): Promise<GenerateQuizResult> {
  return callGemini(apiKey, buildStudyLogPrompt(notes, categoryName, maxQuestions), maxQuestions);
}

/** ノート本文から生成する */
export function generateQuizFromNotebook(
  apiKey: string | undefined,
  title: string,
  content: string,
  categoryName: string,
  maxQuestions: number,
): Promise<GenerateQuizResult> {
  return callGemini(
    apiKey,
    buildNotebookPrompt(title, content, categoryName, maxQuestions),
    maxQuestions,
  );
}

/** 用語＋説明から 1 問だけ生成する */
export function generateQuizFromTerm(
  apiKey: string | undefined,
  term: string,
  description: string,
  categoryName: string,
): Promise<GenerateQuizResult> {
  return callGemini(apiKey, buildSingleTermPrompt(term, description, categoryName), 1);
}

// ---------------------------------------------------------------------------
// 用語辞書の補完
// ---------------------------------------------------------------------------

export interface DefinedTerm {
  definition: string;
  tags: string[];
}

export interface DefineTermResult {
  term: DefinedTerm | null;
  warning?: string;
}

/**
 * プロンプトに載せる既存タグの上限。
 * 全部載せると、タグが増えたユーザーほど本文が押し出されて指示が薄まる。
 */
export const MAX_PROMPT_TAGS = 40;

/** 意味の上限。ここを超える応答は切り詰めず、長すぎるものとして扱う */
const MAX_AI_DEFINITION_LENGTH = 400;

const DEFINITION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    definition: {
      type: Type.STRING,
      description: '用語の意味。日本語で2〜3文、200文字以内。',
    },
    tags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '分野・ジャンルのタグを1〜3個。既存のタグを優先して選ぶ。',
    },
  },
  required: ['definition', 'tags'],
  propertyOrdering: ['definition', 'tags'],
};

/** 応答を検証する。意味が空なら補完になっていないので捨てる。 */
function coerceDefinition(parsed: unknown): DefinedTerm | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const item = parsed as Record<string, unknown>;

  const definition = typeof item.definition === 'string' ? item.definition.trim() : '';
  if (!definition) return null;

  return {
    definition: definition.slice(0, MAX_AI_DEFINITION_LENGTH),
    // 問題生成と同じ関数を通す（1〜3 個・重複除去）
    tags: coerceTags(item.tags),
  };
}

function buildDefineTermPrompt(
  term: string,
  currentDefinition: string,
  existingTags: readonly string[],
  categoryName: string,
): string {
  const definitionRule = currentDefinition
    ? '学習者が書いた説明を土台にする。言葉を整え、足りない要点だけを補う。書かれていない主張を足さない。'
    : '2〜3文で説明する。1文目で「何であるか」を言い切り、残りで役割・使いどころを補う。';

  /*
   * **既存タグの一覧はいちばん最後に置く。**
   * 指示は末尾ほど守られるうえ、ここが効かないとタグが
   * 「通信 / 通信技術 / ネットワーク」に分裂して、絞り込みが機能しなくなる。
   */
  return `あなたは学習者の用語辞書を整える編集者です。
「${categoryName}」を学んでいる人が、次の用語を辞書に登録しようとしています。

用語: ${term}
学習者が書いた説明: ${currentDefinition || '（未記入）'}

この用語の「意味」と「分野タグ」を作ってください。

制約:
- definition: ${definitionRule}
- definition は**200文字以内**。「〜とは、」のような前置きや、同じ内容の言い換えを書かない。
- tags: 1〜3個。**まず下の「既存のタグ」から合うものを選ぶ**。
  合うものが一つも無いときだけ、新しいタグを1個だけ作ってよい。
  タグは分野名にする（例: 'ネットワーク', 'セキュリティ', 'データベース'）。
  用語名そのものをタグにしない。
- 出力はすべて日本語で書く。

既存のタグ: ${existingTags.length > 0 ? existingTags.slice(0, MAX_PROMPT_TAGS).join(' / ') : '（まだありません）'}`;
}

/**
 * 用語の「意味」と「タグ」を補う。
 *
 * **既存タグを渡すのが本体。** 渡さないと毎回新しい言い回しのタグが増え、
 * 同じ分野が別のタグに割れて、辞書の絞り込みが役に立たなくなる。
 */
export function defineTermWithAI(
  apiKey: string | undefined,
  term: string,
  /** 学習者が書きかけた説明。空文字なら「まだ何も書いていない」 */
  currentDefinition: string,
  /** そのユーザーが既に使っているタグ（利用数の多い順） */
  existingTags: readonly string[],
  categoryName: string,
): Promise<DefineTermResult> {
  return callGeminiJson(
    apiKey,
    buildDefineTermPrompt(term, currentDefinition, existingTags, categoryName),
    DEFINITION_SCHEMA,
    coerceDefinition,
    {
      missingKey: 'GEMINI_API_KEY が未設定のため補完できませんでした。',
      unusable: 'AI の応答から意味を取り出せませんでした。もう一度試してください。',
    },
  ).then(({ value, warning }) => ({ term: value, warning }));
}
