/**
 * Web Audio API による集中サウンドとアラーム。
 *
 * 音源ファイルを持たず、その場でノイズを生成する（バンドルを増やさないため）。
 * AudioContext はユーザー操作を起点にしか開始できないので、必ずクリック等から呼ぶこと。
 */

export type SoundKind = 'white' | 'brown';

let context: AudioContext | null = null;

function getContext(): AudioContext {
  if (!context) {
    context = new AudioContext();
  }
  return context;
}

/** 2 秒分のノイズを作ってループ再生する。毎フレーム生成するより遥かに軽い。 */
function createNoiseBuffer(ctx: AudioContext, kind: SoundKind): AudioBuffer {
  const length = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  if (kind === 'white') {
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  // ブラウンノイズ: 白色ノイズを積分すると低音寄りになり、雨音のように聞こえる
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  return buffer;
}

export interface FocusSound {
  stop: () => void;
  setVolume: (volume: number) => void;
}

/**
 * 集中サウンドを再生する。戻り値の stop() を必ず呼んで後始末すること。
 * @param volume 0〜1
 */
export function startFocusSound(kind: SoundKind, volume = 0.15): FocusSound {
  const ctx = getContext();
  void ctx.resume();

  const source = ctx.createBufferSource();
  source.buffer = createNoiseBuffer(ctx, kind);
  source.loop = true;

  // 高域を落として耳あたりを柔らかくする
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = kind === 'brown' ? 1000 : 5000;

  const gain = ctx.createGain();
  gain.gain.value = 0;

  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start();
  // 立ち上がりでプツッと鳴らないようフェードイン
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.4);

  let stopped = false;
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
      setTimeout(() => {
        try {
          source.stop();
        } catch {
          // 既に停止済み
        }
        source.disconnect();
        filter.disconnect();
        gain.disconnect();
      }, 400);
    },
    setVolume: (next: number) => {
      if (stopped) return;
      gain.gain.linearRampToValueAtTime(next, ctx.currentTime + 0.1);
    },
  };
}

/**
 * ポモドーロのフェーズ切替を知らせるビープ。
 * @param times 鳴らす回数（集中→休憩は2回、休憩→集中は3回など区別に使う）
 */
export function playAlarm(times = 2): void {
  const ctx = getContext();
  void ctx.resume();

  for (let i = 0; i < times; i++) {
    const start = ctx.currentTime + i * 0.35;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    // クリックノイズを避けるため、包絡線で立ち上げ・立ち下げる
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
    gain.gain.linearRampToValueAtTime(0, start + 0.25);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.3);
  }
}
