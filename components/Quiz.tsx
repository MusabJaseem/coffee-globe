"use client";

import { useState } from "react";
import { QUIZ } from "@/lib/taste";

interface Props {
  onDone: (answers: Record<string, number>) => void;
  onClose: () => void;
}

export default function Quiz({ onDone, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const q = QUIZ[step];

  function choose(i: number) {
    const next = { ...answers, [q.id]: i };
    setAnswers(next);
    if (step === QUIZ.length - 1) onDone(next);
    else setStep(step + 1);
  }

  return (
    <div className="quiz" role="dialog" aria-modal="true" aria-labelledby="quiz-q">
      <div className="quiz-top">
        <button className="text-btn" onClick={step === 0 ? onClose : () => setStep(step - 1)}>
          {step === 0 ? "Close" : "Back"}
        </button>
        <div
          className="quiz-progress"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={QUIZ.length}
          aria-valuenow={step + 1}
          aria-label={`Question ${step + 1} of ${QUIZ.length}`}
        >
          {QUIZ.map((_, i) => (
            <span key={i} className={i <= step ? "on" : ""} />
          ))}
        </div>
      </div>
      <h2 id="quiz-q" className="quiz-q">
        {q.prompt}
      </h2>
      <div className="quiz-options">
        {q.options.map((o, i) => (
          <button key={o.label} className={`quiz-opt${answers[q.id] === i ? " picked" : ""}`} onClick={() => choose(i)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
