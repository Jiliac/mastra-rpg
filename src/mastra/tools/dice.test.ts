import { describe, it, expect, vi } from 'vitest';
import { rollDice, diceTool } from './dice';

describe('rollDice', () => {
  it('parses and rolls 2d6 with a fixed RNG', () => {
    const rng = vi.fn().mockReturnValueOnce(0.0).mockReturnValueOnce(0.99); // 1, then 6
    const r = rollDice('2d6', rng);
    expect(r.expression).toBe('2d6');
    expect(r.rolls).toEqual([1, 6]);
    expect(r.total).toBe(7);
    expect(r.breakdown).toBe('2d6: [1, 6] = 7');
  });

  it('applies a positive modifier (2d6+1)', () => {
    const rng = vi.fn().mockReturnValueOnce(0.5).mockReturnValueOnce(0.5); // 4, 4
    const r = rollDice('2d6+1', rng);
    expect(r.rolls).toEqual([4, 4]);
    expect(r.total).toBe(9);
    expect(r.breakdown).toBe('2d6+1: [4, 4] + 1 = 9');
  });

  it('applies a negative modifier (1d20-3)', () => {
    const rng = vi.fn().mockReturnValueOnce(0.95); // 20
    const r = rollDice('1d20-3', rng);
    expect(r.rolls).toEqual([20]);
    expect(r.total).toBe(17);
    expect(r.breakdown).toBe('1d20-3: [20] - 3 = 17');
  });

  it('aliases pbta to 2d6', () => {
    const rng = vi.fn().mockReturnValueOnce(0.5).mockReturnValueOnce(0.99); // 4, 6
    const r = rollDice('pbta+2', rng);
    expect(r.rolls).toEqual([4, 6]);
    expect(r.total).toBe(12);
    expect(r.breakdown).toBe('pbta+2: [4, 6] + 2 = 12');
  });

  it('advantage rolls 2d20 and keeps the higher', () => {
    const rng = vi.fn().mockReturnValueOnce(0.05).mockReturnValueOnce(0.85); // 2, 18
    const r = rollDice('advantage', rng);
    expect(r.rolls).toEqual([2, 18]);
    expect(r.total).toBe(18);
    expect(r.breakdown).toBe('advantage: [2, 18] keep higher = 18');
  });

  it('disadvantage rolls 2d20 and keeps the lower', () => {
    const rng = vi.fn().mockReturnValueOnce(0.05).mockReturnValueOnce(0.85); // 2, 18
    const r = rollDice('disadvantage', rng);
    expect(r.rolls).toEqual([2, 18]);
    expect(r.total).toBe(2);
    expect(r.breakdown).toBe('disadvantage: [2, 18] keep lower = 2');
  });

  it('is case-insensitive and trims whitespace', () => {
    const rng = vi.fn().mockReturnValueOnce(0.5).mockReturnValueOnce(0.5);
    const r = rollDice('  2D6  ', rng);
    expect(r.expression).toBe('2d6');
    expect(r.total).toBe(8);
  });

  it('throws on garbage input', () => {
    expect(() => rollDice('foo', () => 0.5)).toThrow(/invalid expression/);
  });

  it('throws on zero dice', () => {
    expect(() => rollDice('0d6', () => 0.5)).toThrow(/invalid expression/);
  });

  it('throws on zero-sided die', () => {
    expect(() => rollDice('2d0', () => 0.5)).toThrow(/invalid expression/);
  });

  it('throws on N above the upper bound (n > 100)', () => {
    expect(() => rollDice('101d6', () => 0.5)).toThrow(/invalid expression/);
  });

  it('throws on M above the upper bound (m > 1000)', () => {
    expect(() => rollDice('1d1001', () => 0.5)).toThrow(/invalid expression/);
  });
});

describe('diceTool', () => {
  it('exposes id "dice" and an input schema with `expression`', () => {
    expect(diceTool.id).toBe('dice');
    expect(diceTool.inputSchema).toBeDefined();
  });

  it('execute() returns a rolled result for a valid expression', async () => {
    // The tool uses Math.random by default; here we just check the shape.
    // @mastra/core@1.32.1 `execute` takes (inputData, context) — see weather-tool.ts.
    const out = (await diceTool.execute!({ expression: '2d6' } as any, {} as any)) as {
      expression: string;
      rolls: number[];
      total: number;
    };
    expect(out.expression).toBe('2d6');
    expect(out.rolls).toHaveLength(2);
    expect(out.rolls.every((n: number) => n >= 1 && n <= 6)).toBe(true);
    expect(out.total).toBe(out.rolls.reduce((s: number, n: number) => s + n, 0));
  });

  it('execute() throws on an invalid expression so Mastra surfaces a tool error', async () => {
    await expect(diceTool.execute!({ expression: 'banana' } as any, {} as any)).rejects.toThrow(
      /invalid expression/,
    );
  });
});
