import { useState, useEffect, useRef } from 'react';
import './Dice.css';

const PIPS = {
  1: [[50,50]],
  2: [[25,25],[75,75]],
  3: [[25,25],[50,50],[75,75]],
  4: [[25,25],[75,25],[25,75],[75,75]],
  5: [[25,25],[75,25],[50,50],[25,75],[75,75]],
  6: [[25,22],[75,22],[25,50],[75,50],[25,78],[75,78]],
};

function DieFace({ value, size = 36 }) {
  if (!value) return <div className="die-face die-face--empty" style={{ width: size, height: size }} />;
  return (
    <div className="die-face" style={{ width: size, height: size }}>
      {PIPS[value]?.map(([x, y], i) => (
        <div
          key={i}
          className="die-pip"
          style={{ left: `${x}%`, top: `${y}%` }}
        />
      ))}
    </div>
  );
}

export default function Dice({ value, secondValue, onRoll, disabled, rollsLeft }) {
  const [rolling, setRolling] = useState(false);
  const prevValueRef = useRef(value);

  useEffect(() => {
    const prev = prevValueRef.current;
    prevValueRef.current = value;
    if (value && !prev) {
      setRolling(true);
      const t = setTimeout(() => setRolling(false), 600);
      return () => clearTimeout(t);
    }
  }, [value]);

  function handleRoll() {
    if (disabled || rolling) return;
    setRolling(true);
    setTimeout(() => setRolling(false), 600);
    onRoll?.();
  }

  return (
    <div className="dice-container">
      <div className="dice-row">
        <div className={`dice-wrapper ${rolling ? 'dice-wrapper--rolling' : ''}`}>
          <DieFace value={value} />
        </div>
        {secondValue && (
          <div className={`dice-wrapper ${rolling ? 'dice-wrapper--rolling' : ''}`}>
            <DieFace value={secondValue} />
          </div>
        )}
      </div>
      <button
        className={`dice-roll-btn btn btn-primary ${disabled ? 'dice-roll-btn--disabled' : ''}`}
        onClick={handleRoll}
        disabled={disabled || rolling}
      >
        🎲 {rollsLeft > 1 ? `(${rollsLeft}x)` : ''}
      </button>
    </div>
  );
}