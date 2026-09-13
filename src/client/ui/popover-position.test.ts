import { describe, expect, it } from 'vitest';
import { POPOVER_GAP, POPOVER_MARGIN, computePopoverPosition } from './popover-position';

const viewport = { width: 1280, height: 720 };
/** 画面の中ほどにある 100×32 のトリガ */
const trigger = { top: 100, bottom: 132, left: 400, right: 500 };
const PANEL = 224; // w-56

describe('computePopoverPosition', () => {
  it('bottom-start はトリガの下、左端をそろえる', () => {
    expect(computePopoverPosition(trigger, 'bottom-start', viewport, PANEL)).toEqual({
      top: 132 + POPOVER_GAP,
      left: 400,
    });
  });

  it('bottom-end はトリガの下、右端をそろえる', () => {
    expect(computePopoverPosition(trigger, 'bottom-end', viewport, PANEL)).toEqual({
      top: 132 + POPOVER_GAP,
      left: 500 - PANEL,
    });
  });

  /* 上に出すときはパネルの高さを知らなくていいよう、画面の下端から測る */
  it('top-* は画面の下端からの距離で上に出す', () => {
    expect(computePopoverPosition(trigger, 'top-start', viewport, PANEL)).toEqual({
      bottom: 720 - 100 + POPOVER_GAP,
      left: 400,
    });
    expect(computePopoverPosition(trigger, 'top-end', viewport, PANEL).bottom).toBe(
      720 - 100 + POPOVER_GAP,
    );
  });

  it('右端のトリガでも画面の外へはみ出さない', () => {
    const nearRight = { top: 100, bottom: 132, left: 1240, right: 1270 };
    const { left } = computePopoverPosition(nearRight, 'bottom-start', viewport, PANEL);
    expect(left + PANEL).toBeLessThanOrEqual(viewport.width - POPOVER_MARGIN);
  });

  it('左端のトリガで end 寄せにしても画面の外へはみ出さない', () => {
    const nearLeft = { top: 100, bottom: 132, left: 4, right: 40 };
    expect(computePopoverPosition(nearLeft, 'bottom-end', viewport, PANEL).left).toBe(
      POPOVER_MARGIN,
    );
  });

  /* 375px のスマホで、横スクロールした行の中のトリガ */
  it('狭い画面でも左右の余白を残す', () => {
    const phone = { width: 375, height: 812 };
    const scrolled = { top: 200, bottom: 232, left: 300, right: 380 };
    const { left } = computePopoverPosition(scrolled, 'bottom-start', phone, PANEL);
    expect(left).toBe(375 - POPOVER_MARGIN - PANEL);
  });

  it('画面より広いパネルは左端に寄せる', () => {
    const tiny = { width: 200, height: 400 };
    expect(computePopoverPosition(trigger, 'bottom-end', tiny, PANEL).left).toBe(POPOVER_MARGIN);
  });
});
