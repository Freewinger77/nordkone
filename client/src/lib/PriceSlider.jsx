import React from 'react';

export function PriceSlider({
  min = 0,
  max = 500000,
  step = 5000,
  valueMin = 0,
  valueMax = 500000,
  histogram = [],
  onChange,
}) {
  const span = Math.max(max - min, 1);
  const low = clamp(valueMin, min, max);
  const high = clamp(valueMax, min, max);
  const left = ((Math.min(low, high) - min) / span) * 100;
  const right = ((Math.max(low, high) - min) / span) * 100;

  function setLow(next) {
    const value = Math.min(Number(next), high);
    onChange?.(value, high);
  }

  function setHigh(next) {
    const value = Math.max(Number(next), low);
    onChange?.(low, value);
  }

  return (
    <div className="air-slider">
      {histogram.length ? (
        <div className="air-hist" aria-hidden="true">
          {histogram.map((value, index) => (
            <i key={index} style={{ height: `${Math.max(8, Math.round(value * 100))}%` }} />
          ))}
        </div>
      ) : null}
      <div className="air-track">
        <b style={{ left: `${left}%`, width: `${Math.max(right - left, 0.8)}%` }} />
        <input
          aria-label="Minimum price"
          max={max}
          min={min}
          onChange={(event) => setLow(event.target.value)}
          step={step}
          type="range"
          value={low}
        />
        <input
          aria-label="Maximum price"
          max={max}
          min={min}
          onChange={(event) => setHigh(event.target.value)}
          step={step}
          type="range"
          value={high}
        />
      </div>
    </div>
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}
