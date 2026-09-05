import confetti from 'canvas-confetti';

/**
 * 達成時の紙吹雪。演出なので失敗しても握りつぶす。
 * prefers-reduced-motion が有効な環境では出さない。
 */
function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 復習を一周し終えたときの派手め */
export function celebrateReviewComplete(): void {
  if (prefersReducedMotion()) return;
  void confetti({
    particleCount: 120,
    spread: 80,
    origin: { y: 0.7 },
    disableForReducedMotion: true,
  });
}

/** ポモドーロ 1 セット完了時の控えめ */
export function celebratePomodoro(): void {
  if (prefersReducedMotion()) return;
  void confetti({
    particleCount: 60,
    spread: 55,
    startVelocity: 35,
    origin: { y: 0.6 },
    disableForReducedMotion: true,
  });
}
