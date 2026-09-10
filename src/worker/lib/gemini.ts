import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { MAX_GENERATED_QUESTIONS } from '../../shared/types';
import { buildChoices, coerceChoiceStyle } from '../../shared/choices';
import { describeGeminiError, isRetryable, retryDelayMs } from './gemini-error';

/**
 * 学習メモ・ノート本文・用語辞書から問題を生成し、用語の意味を補う。
 *
 * 呼び出し側の前提: この関数群は例外を投げない。失敗しても空の結果と warning を返し、
 * 学習記録やノートの保存という主機能を AI 側の障害に巻き込ませない。
 *
 * **warning は「できなかった理由」だけを書く。** 元の入力が保存されたかどうかは
 * 呼び出し側の事情なので、保存済みだと添えたい経路は CONTENT_KEPT を自分で足す。
 */

export interface GeneratedQuestion {
  question: string;
  answer: string;
  explanation: string;
  /** 4択の選択肢。**ちょうど 4 個**で、正解をひとつ含む */
  choices: string[];
  /** ジャンルタグ。1〜3 個。 */
  tags: string[];
}

/**
 * 出題の主題。
 *
 * `examName` は**プロンプトに載る唯一の外部からの指定**で、出題の粒度をその試験に寄せる。
 * 未設定（null）なら、汎用の資格試験風に作る。
 */
export interface QuizSubject {
  categoryName: string;
  examName: string | null;
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

/**
 * 応答の形。**用語辞書からの生成だけ `sourceTerm` が要る**（どの用語から作ったかの対応付け）。
 * 残りは全経路で同じなので、1 か所から作る。
 */
function quizSchema(withSourceTerm: boolean) {
  const properties = {
    ...(withSourceTerm
      ? { sourceTerm: { type: Type.STRING, description: '入力した用語名をそのまま書き写す。' } }
      : {}),
    question: {
      type: Type.STRING,
      description: '問題文。資格試験の出題文と同じ体裁で書く。',
    },
    choiceStyle: {
      type: Type.STRING,
      description: "選択肢の型。'term'（用語を選ばせる）か 'statement'（記述を選ばせる）。",
    },
    answer: {
      type: Type.STRING,
      description: '正解。choices のどれか1つと1文字も違わないように書き写す。',
    },
    choices: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '選択肢をちょうど4個。正解1個と誤答3個。',
    },
    explanation: {
      type: Type.STRING,
      description: '150文字以内の解説。誤答がなぜ違うのかにも触れる。',
    },
    tags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        'この問題が属する分野・ジャンルのタグを1〜3個。例: ネットワーク, セキュリティ, データベース',
    },
  };
  const keys = Object.keys(properties);

  return {
    type: Type.OBJECT,
    properties: {
      questions: {
        type: Type.ARRAY,
        items: { type: Type.OBJECT, properties, required: keys, propertyOrdering: keys },
      },
    },
    required: ['questions'],
  };
}

const RESPONSE_SCHEMA = quizSchema(false);

/**
 * 全経路で共通の作問ルール。**資格試験の本試験と同じ体裁で作らせる。**
 *
 * `choiceStyle` を宣言させているのは、**誤答の埋め方が型で変わる**から。
 * `buildChoices`（`shared/choices.ts`）は記述型では誤答を補わず、
 * 4 個そろわない問題を捨てる。用語名を 1 個だけ混ぜた 4 択は、読まなくても答えが分かる。
 */
const QUIZ_RULES = `形式: 4択。**資格試験の本試験と同じ体裁**で作る。

制約:
- choiceStyle: この問題の選択肢の型を宣言する。
  - 'term': 定義・役割を説明した文を読ませ、**あてはまる用語を選ばせる**。選択肢は用語名。
  - 'statement': 「〜に関する記述のうち、適切なものはどれか。」のように**記述文を選ばせる**。
  用語と意味の対応を問うなら 'term'、仕組み・手順・特徴の理解を問えるなら 'statement' を選ぶ。
- question: 問いを1〜2文で完結させる。'term' では答えの用語そのものを問題文に含めてはいけない。
- answer: **choices のどれか1つと1文字も違わない**ように書き写す。
  'term' なら30文字以内、'statement' なら60文字以内。
- choices: **ちょうど4個**。正解1個と誤答3個。
  - 誤答は**同じ分野・同じ粒度**にする。明らかに分野違いのものを混ぜない。
  - **長さで正解が分かる並びにしない。** 4個の文字数をそろえる。
  - 'statement' の誤答は「正しそうだが1点だけ誤っている」文にする。否定するだけの文にしない。
  - 同じ語・同じ文を2回入れない。
- explanation: **150文字以内**。正解の理由に加えて、**誤答がなぜ違うのかに必ず1文触れる**。
- tags: その問題が属する分野・ジャンルのタグを1〜3個付与する（例: 'ネットワーク', 'セキュリティ', 'データベース'）。
  タグは一般的な分野名にし、問題文をそのまま繰り返さないこと。
- 入力に含まれない知識を持ち出さない。入力の内容に忠実に作る。
- 出力はすべて日本語で書く。`;

/** 資格試験名の 1 行。未設定なら何も足さない */
function examLine(examName: string | null): string {
  if (!examName) return '';
  return `この問題は「${examName}」の対策に使う。その試験で実際に問われる範囲・粒度・言い回しに寄せること。
`;
}

/** 「無理に水増ししない」の 1 行。素材から取れる問数は素材が決める */
function countLine(maxQuestions: number): string {
  return `重要な点が${maxQuestions}個に満たなければ、無理に水増しせず少ない問数で構いません。`;
}

function buildStudyLogPrompt(notes: string, subject: QuizSubject, maxQuestions: number): string {
  return `あなたは資格試験の作問者です。
以下は学習者が「${subject.categoryName}」の学習後に書いた学びのメモです。
${examLine(subject.examName)}
--- 学習メモ ここから ---
${notes}
--- 学習メモ ここまで ---

このメモから、核となる重要事項を【最大${maxQuestions}問】選定して問題を作成してください。
${countLine(maxQuestions)}

${QUIZ_RULES}`;
}

function buildNotebookPrompt(
  title: string,
  content: string,
  subject: QuizSubject,
  maxQuestions: number,
): string {
  return `あなたは資格試験の作問者です。
以下は学習者が「${subject.categoryName}」について書いた Markdown 形式の学習ノートです。
${examLine(subject.examName)}
--- ノート「${title}」ここから ---
${content}
--- ノート ここまで ---

このノートから、核となる重要事項を【最大${maxQuestions}問】選定して問題を作成してください。
見出しや箇条書きの記法そのものは問題にせず、内容から出題すること。
${countLine(maxQuestions)}

${QUIZ_RULES}`;
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

/** 応答から `answer` だけを拾う。用語型の誤答を埋める材料になる */
function answersOf(rawList: readonly unknown[]): string[] {
  const answers: string[] = [];
  for (const raw of rawList) {
    if (typeof raw !== 'object' || raw === null) continue;
    const answer = (raw as Record<string, unknown>).answer;
    if (typeof answer === 'string' && answer.trim()) answers.push(answer.trim());
  }
  return answers;
}

/**
 * パース結果を実行時に検証し、不正な要素は捨てる。
 *
 * **2 周する。** 1 周目で答えを集めて誤答の材料（pool）にし、2 周目で選択肢を組む。
 * 用語を選ばせる問題は、同じ生成に含まれる他の問題の答えがそのまま良い誤答になる。
 */
function coerceQuestions(parsed: unknown, maxQuestions: number): GeneratedQuestion[] {
  if (typeof parsed !== 'object' || parsed === null) return [];
  const rawList = (parsed as { questions?: unknown }).questions;
  if (!Array.isArray(rawList)) return [];

  const pool = answersOf(rawList);

  const result: GeneratedQuestion[] = [];
  for (const raw of rawList) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const question = typeof item.question === 'string' ? item.question.trim() : '';
    const answer = typeof item.answer === 'string' ? item.answer.trim() : '';
    const explanation = typeof item.explanation === 'string' ? item.explanation.trim() : '';
    if (!question || !answer) continue;

    // 4 個そろわない 4 択は問題として成立しない（記述型は補充もできない）
    const choices = buildChoices(item.choices, answer, coerceChoiceStyle(item.choiceStyle), pool);
    if (choices.length === 0) continue;

    result.push({ question, answer, explanation, choices, tags: coerceTags(item.tags) });
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

/** 4択の生成。学習メモとノートが通る道 */
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
      unusable:
        'AI の応答から問題を抽出できませんでした。入力に用語が少ないか、4択の選択肢がそろわなかった可能性があります。',
    },
  );

  return value ? { questions: value } : { questions: [], warning };
}

/** 学習メモから生成する */
export function generateQuizFromStudyLog(
  apiKey: string | undefined,
  notes: string,
  subject: QuizSubject,
  maxQuestions: number,
): Promise<GenerateQuizResult> {
  return callGemini(apiKey, buildStudyLogPrompt(notes, subject, maxQuestions), maxQuestions);
}

/** ノート本文から生成する */
export function generateQuizFromNotebook(
  apiKey: string | undefined,
  title: string,
  content: string,
  subject: QuizSubject,
  maxQuestions: number,
): Promise<GenerateQuizResult> {
  return callGemini(
    apiKey,
    buildNotebookPrompt(title, content, subject, maxQuestions),
    maxQuestions,
  );
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

// ---------------------------------------------------------------------------
// 用語辞書からの出題
// ---------------------------------------------------------------------------

export interface GlossarySourceTerm {
  term: string;
  definition: string;
  tags: string[];
}

export interface GeneratedGlossaryQuestion extends GeneratedQuestion {
  /**
   * どの用語から作ったか。**入力の term と完全一致しなければ捨てる。**
   *
   * これが無いと、返ってきた N 問を用語に対応付ける手段が順番しか無くなる。
   * 順番は保証されないし、モデルは平気で 1 問落とす。
   */
  sourceTerm: string;
}

export interface GenerateGlossaryResult {
  questions: GeneratedGlossaryQuestion[];
  warning?: string;
}

/** 1 回の生成で渡せる用語の数。1 用語 = 1 問 */
export const MAX_GLOSSARY_TERMS_PER_REQUEST = 10;

const GLOSSARY_RESPONSE_SCHEMA = quizSchema(true);

function buildGlossaryPrompt(terms: readonly GlossarySourceTerm[], subject: QuizSubject): string {
  const list = terms
    .map((term, index) => {
      const lines = [`${index + 1}. ${term.term}`, `   意味: ${term.definition || '（未記入）'}`];
      if (term.tags.length > 0) lines.push(`   タグ: ${term.tags.join(', ')}`);
      return lines.join('\n');
    })
    .join('\n');

  return `あなたは資格試験の作問者です。
「${subject.categoryName}」を学んでいる人の用語辞書から、${terms.length}問を作成してください。
${examLine(subject.examName)}
--- 用語リスト ここから ---
${list}
--- 用語リスト ここまで ---

**リストの用語1つにつき、ちょうど1問**を作ってください。
sourceTerm には、その問題の元になった用語名をリストからそのまま書き写してください
（1文字でも変えると対応付けられません）。
入力に含まれない知識を持ち出さず、意味の内容に忠実に作ってください。

${QUIZ_RULES}`;
}

/** 応答を検証する。**入力に無い用語や、形式を満たせない問題はここで捨てる。** */
function coerceGlossaryQuestions(
  parsed: unknown,
  terms: readonly GlossarySourceTerm[],
): GeneratedGlossaryQuestion[] {
  if (typeof parsed !== 'object' || parsed === null) return [];
  const rawList = (parsed as { questions?: unknown }).questions;
  if (!Array.isArray(rawList)) return [];

  const known = new Map(terms.map((term) => [term.term, term]));
  // 4択の誤答を埋める材料。同じ生成に含まれる他の用語名
  const pool = terms.map((term) => term.term);

  const used = new Set<string>();
  const result: GeneratedGlossaryQuestion[] = [];

  for (const raw of rawList) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;

    const sourceTerm = typeof item.sourceTerm === 'string' ? item.sourceTerm.trim() : '';
    const source = known.get(sourceTerm);
    // 入力に無い用語を返してきたら捨てる（対応付けられないものは保存できない）
    if (!source || used.has(sourceTerm)) continue;

    const answer = typeof item.answer === 'string' ? item.answer.trim() : '';
    const question = typeof item.question === 'string' ? item.question.trim() : '';
    const explanation = typeof item.explanation === 'string' ? item.explanation.trim() : '';
    if (!question || !answer) continue;

    // 4 個そろわない 4 択は問題として成立しない（記述型は補充もできない）
    const choices = buildChoices(item.choices, answer, coerceChoiceStyle(item.choiceStyle), pool);
    if (choices.length === 0) continue;

    used.add(sourceTerm);
    result.push({
      sourceTerm,
      question,
      answer,
      explanation,
      choices,
      // 元の用語のタグを引き継ぐ。辞書とカードでタグが割れないようにする
      tags:
        source.tags.length > 0
          ? source.tags.slice(0, MAX_TAGS_PER_QUESTION)
          : coerceTags(item.tags),
    });
  }

  return result.slice(0, terms.length);
}

/** 用語辞書から 1 用語 1 問ずつ作る */
export async function generateQuestionsFromGlossary(
  apiKey: string | undefined,
  terms: readonly GlossarySourceTerm[],
  subject: QuizSubject,
): Promise<GenerateGlossaryResult> {
  if (terms.length === 0) return { questions: [] };

  const { value, warning } = await callGeminiJson(
    apiKey,
    buildGlossaryPrompt(terms, subject),
    GLOSSARY_RESPONSE_SCHEMA,
    (parsed) => {
      const questions = coerceGlossaryQuestions(parsed, terms);
      return questions.length > 0 ? questions : null;
    },
    {
      missingKey: 'GEMINI_API_KEY が未設定のため問題を生成できませんでした。',
      unusable:
        'AI の応答から問題を抽出できませんでした。用語の意味を書くと作りやすくなります（4択の選択肢がそろわなかった可能性もあります）。',
    },
  );

  return value ? { questions: value } : { questions: [], warning };
}

export interface BulkDefinedTerm {
  /** 入力した用語名。**入力と完全一致しなければ捨てる** */
  sourceTerm: string;
  definition: string;
  tags: string[];
}

export interface DefineTermsResult {
  terms: BulkDefinedTerm[];
  warning?: string;
}

const DEFINITIONS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    terms: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          sourceTerm: { type: Type.STRING, description: '入力した用語名をそのまま書き写す。' },
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
        required: ['sourceTerm', 'definition', 'tags'],
        propertyOrdering: ['sourceTerm', 'definition', 'tags'],
      },
    },
  },
  required: ['terms'],
};

/** 応答を検証する。入力に無い用語・重複・空の意味は捨てる */
function coerceDefinitions(parsed: unknown, terms: readonly string[]): BulkDefinedTerm[] {
  if (typeof parsed !== 'object' || parsed === null) return [];
  const rawList = (parsed as { terms?: unknown }).terms;
  if (!Array.isArray(rawList)) return [];

  const known = new Set(terms);
  const used = new Set<string>();
  const result: BulkDefinedTerm[] = [];

  for (const raw of rawList) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;

    const sourceTerm = typeof item.sourceTerm === 'string' ? item.sourceTerm.trim() : '';
    // 貼り付けの取りこぼしに対して、それらしい説明を作ってくることがある
    if (!known.has(sourceTerm) || used.has(sourceTerm)) continue;

    const definition = typeof item.definition === 'string' ? item.definition.trim() : '';
    if (!definition) continue;

    used.add(sourceTerm);
    result.push({
      sourceTerm,
      definition: definition.slice(0, MAX_AI_DEFINITION_LENGTH),
      tags: coerceTags(item.tags),
    });
  }

  return result.slice(0, terms.length);
}

function buildDefineTermsPrompt(
  terms: readonly string[],
  existingTags: readonly string[],
  categoryName: string,
): string {
  const list = terms.map((term, index) => `${index + 1}. ${term}`).join('\n');

  /*
   * 下の 2 行が「まとめて 1 回で呼ぶ」ことの意味そのもの。
   * - 貼り付けには解釈の取りこぼしが混ざる。それらしい説明を作られるほうが困る
   * - 1 回で呼べばリスト全体が見えるので、分野ごとにタグを揃えられる（N 回では原理的に無理）
   */
  return `あなたは学習者の用語辞書を整える編集者です。
「${categoryName}」を学んでいる人が、次の用語をまとめて辞書に登録しようとしています。

--- 用語リスト ここから ---
${list}
--- 用語リスト ここまで ---

**リストの用語1つにつき、ちょうど1件**の「意味」と「分野タグ」を作ってください。
sourceTerm には、その用語名をリストからそのまま書き写してください
（1文字でも変えると対応付けられません）。

制約:
- definition: 2〜3文で説明する。1文目で「何であるか」を言い切り、残りで役割・使いどころを補う。
- definition は**200文字以内**。「〜とは、」のような前置きや、同じ内容の言い換えを書かない。
- **意味の分からない語や、用語になっていない行は、でっち上げずに出力から省く。**
  貼り付けの取りこぼしが混ざっていることがあり、それらしい説明を作られるほうが困ります。
- tags: 1〜3個。**まず下の「既存のタグ」から合うものを選ぶ**。
  合うものが一つも無いときだけ、新しいタグを1個だけ作ってよい。
  タグは分野名にする（例: 'ネットワーク', 'セキュリティ', 'データベース'）。
  用語名そのものをタグにしない。
- **同じ分野の用語には同じタグを付ける。** リストの中でタグが割れないようにする。
- 出力はすべて日本語で書く。

既存のタグ: ${existingTags.length > 0 ? existingTags.slice(0, MAX_PROMPT_TAGS).join(' / ') : '（まだありません）'}`;
}

/**
 * 空の意味をまとめて補う。**1 回の呼び出しでリスト全部を見る。**
 *
 * 用語ごとに呼ぶより、同じ分野に同じタグが付く（分野が割れない）のが大きい。
 * 件数を増やしすぎないのは、応答が途中で切れると `parseJsonSafely` が null を返して
 * **その回が全滅**するため。危険は件数に比例する（→ MAX_DEFINE_TERMS_PER_REQUEST）。
 */
export function defineTermsWithAI(
  apiKey: string | undefined,
  /** 意味が空の用語だけ。既に書いてあるものは渡さない */
  terms: readonly string[],
  existingTags: readonly string[],
  categoryName: string,
): Promise<DefineTermsResult> {
  if (terms.length === 0) return Promise.resolve({ terms: [] });

  return callGeminiJson(
    apiKey,
    buildDefineTermsPrompt(terms, existingTags, categoryName),
    DEFINITIONS_SCHEMA,
    (parsed) => {
      const defined = coerceDefinitions(parsed, terms);
      return defined.length > 0 ? defined : null;
    },
    {
      missingKey: 'GEMINI_API_KEY が未設定のため補完できませんでした。',
      unusable: 'AI の応答から意味を取り出せませんでした。もう一度試してください。',
    },
  ).then(({ value, warning }) => ({ terms: value ?? [], warning }));
}
