import { useEffect, useRef, useState } from 'react';
import { makeProblem, evaluateAnswer, Problem } from '../lib/exitChallenge';
import styles from './ExitGate.module.css';

// A grown-up-only gate: solve a small multiplication problem to leave. Digits
// are evaluated as they're typed (no Enter). A wrong answer bails out and tells
// the parent to lock the exit for a while; tapping outside just keeps painting.
//
// The answer is a focused numeric input (inputMode="numeric") so phones/tablets
// pop the on-screen number keypad; a physical keyboard types into it just the
// same.

export default function ExitGate({
  onSolved,
  onWrong,
  onCancel,
  problem: injected,
}: {
  onSolved: () => void;
  onWrong: () => void;
  onCancel: () => void;
  problem?: Problem;
}) {
  const [problem] = useState<Problem>(() => injected ?? makeProblem());
  const [typed, setTyped] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus on open so a physical keyboard works immediately and mobile has the
  // best chance of raising the keypad without an extra tap.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handle = (raw: string) => {
    const digits = raw.replace(/\D/g, ''); // ignore anything but digits
    const state = evaluateAnswer(problem.answer, digits);
    if (state === 'correct') {
      onSolved();
      return;
    }
    if (state === 'wrong') {
      onWrong();
      return;
    }
    setTyped(digits);
  };

  return (
    <div className={styles.backdrop} onPointerDown={onCancel}>
      <div className={styles.box} onPointerDown={(e) => e.stopPropagation()}>
        <p className={styles.prompt}>A grown-up question to leave:</p>
        <p className={styles.problem}>
          {problem.a} × {problem.b} ={' '}
          <input
            ref={inputRef}
            className={styles.answer}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            aria-label="Answer"
            placeholder="?"
            value={typed}
            onChange={(e) => handle(e.target.value)}
          />
        </p>
        <p className={styles.hint}>Type the answer · tap outside to keep painting</p>
      </div>
    </div>
  );
}
