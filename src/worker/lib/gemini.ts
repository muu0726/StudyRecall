import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { MAX_GENERATED_QUESTIONS } from '../../shared/types';

/**
 * 学習メモ・ノート本文・単一用語から一問一答を生成する。
 *
 * 呼び出し側の前提: この関数群は例外を投げない。失敗しても { questions: [], warning }
 * を返し、学習記録やノートの保存という主機能を AI 側の障害に巻き込ませない。
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
/** 高負荷時の 503/429 は一時的なことが多いので一度だけ待って再試行する */
const RETRY_STATUSES = [429, 503];
const RETRY_DELAY_MS = 1_200;

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

/** Gemini 呼び出しの共通部分。ここだけが例外を握りつぶす。 */
async function callGemini(
  apiKey: string | undefined,
  prompt: string,
  maxQuestions: number,
): Promise<GenerateQuizResult> {
  if (!apiKey) {
    return {
      questions: [],
      warning:
        'GEMINI_API_KEY が未設定のため問題を生成できませんでした。内容は保存されています。',
    };
  }

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
          responseSchema: RESPONSE_SCHEMA,
          // MVP では応答速度を優先し、思考を最小限にする
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          temperature: 0.4,
          abortSignal: deadline,
        },
      });

    let response: Awaited<ReturnType<typeof callOnce>>;
    try {
      response = await callOnce();
    } catch (firstError) {
      const status = (firstError as { status?: number })?.status;
      const isRetryable =
        (typeof status === 'number' && RETRY_STATUSES.includes(status)) ||
        RETRY_STATUSES.some((code) => String(firstError).includes(String(code)));
      if (!isRetryable) throw firstError;
      console.warn('[gemini] retrying after transient error:', firstError);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      response = await callOnce();
    }

    const text = response.text;
    if (!text) {
      return { questions: [], warning: 'AI からの応答が空でした。内容は保存されています。' };
    }

    const questions = coerceQuestions(parseJsonSafely(text), maxQuestions);
    if (questions.length === 0) {
      return {
        questions: [],
        warning:
          'AI の応答から問題を抽出できませんでした。入力に用語が少ない可能性があります。内容は保存されています。',
      };
    }
    return { questions };
  } catch (error) {
    console.error('[gemini] generation failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    return {
      questions: [],
      warning: `問題の生成に失敗しました（${message}）。内容は保存されています。`,
    };
  }
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
