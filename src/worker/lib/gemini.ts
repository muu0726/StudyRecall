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

/** Gemini 呼び出しの共通部分。ここだけが例外を握りつぶす。 */
async function callGemini(
  apiKey: string | undefined,
  prompt: string,
  maxQuestions: number,
): Promise<GenerateQuizResult> {
  if (!apiKey) {
    return {
      questions: [],
      warning: 'GEMINI_API_KEY が未設定のため問題を生成できませんでした。',
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
    if (!text) {
      return { questions: [], warning: 'AI からの応答が空でした。' };
    }

    const questions = coerceQuestions(parseJsonSafely(text), maxQuestions);
    if (questions.length === 0) {
      return {
        questions: [],
        warning: 'AI の応答から問題を抽出できませんでした。入力に用語が少ない可能性があります。',
      };
    }
    return { questions };
  } catch (error) {
    // 生の中身はここに残す。画面には出さないが、調べるときに要る。
    console.error('[gemini] generation failed:', error);
    return { questions: [], warning: describeGeminiError(error) };
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
