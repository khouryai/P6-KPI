/**
 * How dense the status report's picture is drawn.
 *
 * The density is the whole of the sharpness: a page meant for 13 inches has to be
 * drawn with enough pixels for 13 inches, and a report too long for the browser's
 * canvas limits has to come down only as far as it must rather than fail.
 */
import { describe, it, expect } from 'vitest';
import { PAINT_TARGETS, pageScale } from '../src/app/reportPaint';

describe('the picture’s density', () => {
  it('a 13 by 7 inch page is drawn at 400 dots to the inch, exactly that shape', () => {
    const t = PAINT_TARGETS.wide;
    expect(t.inches).toBe(13);
    expect(t.pageInches).toBe(7);
    const scale = (400 * t.inches) / t.width;
    const pageH = ((t.pageInches as number) * t.width) / t.inches;
    const s = pageScale(scale, t.width, pageH);
    expect(Math.round(t.width * s)).toBe(5200);
    expect(Math.round(pageH * s)).toBe(2800);
  });

  it('a very tall picture comes down only as far as the canvas limits need', () => {
    const t = PAINT_TARGETS.screen;
    const scale = (400 * t.inches) / t.width;
    const tall = 9000;
    const s = pageScale(scale, t.width, tall);
    expect(s).toBeLessThan(scale);
    expect(tall * s).toBeLessThanOrEqual(16000);
    expect(t.width * s * tall * s).toBeLessThanOrEqual(120_000_000);
  });

  it('never draws below one pixel to the unit', () => {
    expect(pageScale(4, 1000, 10_000_000)).toBe(1);
  });
});
