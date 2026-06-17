import { describe, it, expect } from 'vitest';
import { makeProblem, evaluateAnswer } from './exitChallenge';

describe('makeProblem', () => {
  it('uses times-table factors (2..9) and a correct product', () => {
    for (let i = 0; i < 100; i++) {
      const p = makeProblem();
      expect(p.a).toBeGreaterThanOrEqual(2);
      expect(p.a).toBeLessThanOrEqual(9);
      expect(p.b).toBeGreaterThanOrEqual(2);
      expect(p.b).toBeLessThanOrEqual(9);
      expect(p.answer).toBe(p.a * p.b);
    }
  });

  it('is deterministic for a given rng', () => {
    const p = makeProblem(() => 0); // a=2, b=2
    expect(p).toEqual({ a: 2, b: 2, answer: 4 });
  });
});

describe('evaluateAnswer', () => {
  it('accepts the exact answer with no Enter key', () => {
    expect(evaluateAnswer(6, '6')).toBe('correct');
    expect(evaluateAnswer(81, '81')).toBe('correct');
  });

  it('treats a correct prefix of a multi-digit answer as incomplete', () => {
    expect(evaluateAnswer(81, '8')).toBe('incomplete');
    expect(evaluateAnswer(144, '1')).toBe('incomplete');
    expect(evaluateAnswer(144, '14')).toBe('incomplete');
  });

  it('rejects a wrong digit immediately', () => {
    expect(evaluateAnswer(81, '9')).toBe('wrong'); // 81 doesn't start with 9
    expect(evaluateAnswer(6, '7')).toBe('wrong');
    expect(evaluateAnswer(81, '85')).toBe('wrong'); // diverges at 2nd digit
  });

  it('treats overshooting the answer length as wrong', () => {
    expect(evaluateAnswer(6, '66')).toBe('wrong');
  });
});
