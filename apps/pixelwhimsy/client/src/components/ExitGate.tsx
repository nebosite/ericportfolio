import { useEffect, useRef, useState } from 'react';
import { makeProblem, evaluateAnswer, Problem } from '../lib/exitChallenge';
import styles from './ExitGate.module.css';

// A grown-up-only gate: solve a small multiplication problem to leave. Digits
// are evaluated on every keypress (no Enter). A wrong answer bails out and tells
// the parent to lock the exit for a while; tapping outside just keeps painting.

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
  const typedRef = useRef('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key < '0' || e.key > '9' || e.key.length !== 1) return;
      e.preventDefault();
      const next = typedRef.current + e.key;
      const state = evaluateAnswer(problem.answer, next);
      if (state === 'correct') {
        onSolved();
        return;
      }
      if (state === 'wrong') {
        onWrong();
        return;
      }
      typedRef.current = next;
      setTyped(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [problem, onSolved, onWrong]);

  return (
    <div className={styles.backdrop} onPointerDown={onCancel}>
      <div className={styles.box} onPointerDown={(e) => e.stopPropagation()}>
        <p className={styles.prompt}>A grown-up question to leave:</p>
        <p className={styles.problem}>
          {problem.a} × {problem.b} = <span className={styles.typed}>{typed || '?'}</span>
        </p>
        <p className={styles.hint}>Type the answer · tap outside to keep painting</p>
      </div>
    </div>
  );
}
