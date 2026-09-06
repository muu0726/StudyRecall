import { describe, expect, it } from 'vitest';
import { toggleMarker } from './markdown-edit';

/**
 * マーカーの付け外し。キャレットの位置まで含めて固定する。
 * 「囲んだのにカーソルが末尾へ飛ぶ」「もう一度押しても外れない」は
 * 目視だと気付きにくく、再現手順も面倒なので、ここで縛る。
 */

/** 選択位置を [ ] で示す記法から呼び出す小道具 */
function run(marked: string) {
  const start = marked.indexOf('[');
  const end = marked.indexOf(']') - 1;
  const text = marked.replace('[', '').replace(']', '');
  const result = toggleMarker(text, start, end);
  return {
    text: result.text,
    selected: result.text.slice(result.selectionStart, result.selectionEnd),
    start: result.selectionStart,
  };
}

describe('toggleMarker', () => {
  it('選んだ語を囲み、中身を選択したままにする', () => {
    const r = run('TCPは[3ウェイ]で接続する');
    expect(r.text).toBe('TCPは==3ウェイ==で接続する');
    expect(r.selected).toBe('3ウェイ');
  });

  it('中身だけ選んだ状態でもう一度押すと外れる', () => {
    const r = run('TCPは==[3ウェイ]==で接続する');
    expect(r.text).toBe('TCPは3ウェイで接続する');
    expect(r.selected).toBe('3ウェイ');
  });

  it('==語== ごと選んでも外れる', () => {
    const r = run('TCPは[==3ウェイ==]で接続する');
    expect(r.text).toBe('TCPは3ウェイで接続する');
    expect(r.selected).toBe('3ウェイ');
  });

  it('選択が無ければ ==== を置いて間にカーソルを入れる', () => {
    const r = run('TCPは[]で接続する');
    expect(r.text).toBe('TCPは====で接続する');
    expect(r.selected).toBe('');
    expect(r.start).toBe('TCPは=='.length);
  });

  /**
   * `== 語 ==` は Obsidian でもマーカーにならない。
   * ダブルクリックの選択に空白が混ざることは普通にあるので、ここで吸収する。
   */
  it('前後の空白は囲みの外に出す', () => {
    const r = run('あ[ 重要 ]い');
    expect(r.text).toBe('あ ==重要== い');
    expect(r.selected).toBe('重要');
  });

  it('空白だけを選んだときは挿入として扱う', () => {
    const r = run('あ[   ]い');
    expect(r.text).toBe('あ====い');
    expect(r.selected).toBe('');
  });

  it('行頭から選んでも壊れない（負の添字を踏まない）', () => {
    const r = run('[重要]な話');
    expect(r.text).toBe('==重要==な話');
    expect(r.selected).toBe('重要');
  });

  it('逆向きの選択（末尾から先頭へドラッグ）でも同じ結果になる', () => {
    const text = 'TCPは3ウェイで接続する';
    const start = text.indexOf('3ウェイ');
    const end = start + '3ウェイ'.length;
    expect(toggleMarker(text, end, start)).toEqual(toggleMarker(text, start, end));
  });

  it('複数回の付け外しで元に戻る', () => {
    const original = 'あ重要い';
    const on = toggleMarker(original, 1, 3);
    const off = toggleMarker(on.text, on.selectionStart, on.selectionEnd);
    expect(off.text).toBe(original);
  });
});
