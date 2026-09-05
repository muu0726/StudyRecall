// 型だけの import はビルド時に消えるので、実体を初回バンドルに引き込まない
import type { Options as ConfettiOptions } from 'canvas-confetti';

/**
 * 達成時の紙吹雪。演出なので失敗しても握りつぶす。
 * prefers-reduced-motion が有効な環境では出さない。
 *
 * canvas-confetti は初回表示に要らないので動的 import にしている。
 * 起動時のバンドルに載せるには、演出のためだけには大きい。
 */

/** 実際に紙吹雪を出す。読み込みや描画に失敗しても学習の流れは止めない。 */
async function fire(options: ConfettiOptions): Promise<void> {
  try {
    const { default: confetti } = await import('canvas-confetti');
    await confetti(options);
  } catch {
    // 演出が出ないだけなので無視する
  }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 復習を一周し終えたときの派手め */
export function celebrateReviewComplete(): void {
  if (prefersReducedMotion()) return;
  void fire({
    particleCount: 120,
    spread: 80,
    origin: { y: 0.7 },
    disableForReducedMotion: true,
  });
}

/** ポモドーロ 1 セット完了時の控えめ */
export function celebratePomodoro(): void {
  if (prefersReducedMotion()) return;
  void fire({
    particleCount: 60,
    spread: 55,
    startVelocity: 35,
    origin: { y: 0.6 },
    disableForReducedMotion: true,
  });
}
