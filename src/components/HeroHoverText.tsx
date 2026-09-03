"use client";

import { useId, useRef, useState, type PointerEvent } from "react";

/**
 * Aceternity Text Hover Effect, sized for inline hero links.
 * https://ui.aceternity.com/components/text-hover-effect
 */
export function HeroHoverText({ text }: { text: string }) {
  const uid = useId().replace(/:/g, "");
  const gradientId = `hero-grad-${uid}`;
  const revealId = `hero-reveal-${uid}`;
  const maskId = `hero-mask-${uid}`;
  const rootRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [mask, setMask] = useState({ cx: "50%", cy: "50%" });

  const onMove = (event: PointerEvent<HTMLSpanElement>) => {
    const node = rootRef.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    if (!box.width || !box.height) return;
    setMask({
      cx: `${((event.clientX - box.left) / box.width) * 100}%`,
      cy: `${((event.clientY - box.top) / box.height) * 100}%`,
    });
  };

  return (
    <span
      ref={rootRef}
      className={`hero-hover${hovered ? " is-hot" : ""}`}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => {
        setHovered(false);
        setMask({ cx: "50%", cy: "50%" });
      }}
      onPointerMove={onMove}
    >
      <span className="hero-hover-ink">{text}</span>
      <svg
        className="hero-hover-svg"
        xmlns="http://www.w3.org/2000/svg"
        width="100%"
        height="100%"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            {hovered ? (
              <>
                <stop offset="0%" stopColor="var(--dither-foam)" stopOpacity="0.95" />
                <stop offset="25%" stopColor="var(--dither-orange)" stopOpacity="0.9" />
                <stop offset="50%" stopColor="var(--dither-red)" stopOpacity="0.88" />
                <stop offset="75%" stopColor="var(--dither-pink)" stopOpacity="0.9" />
                <stop offset="100%" stopColor="var(--dither-purple)" stopOpacity="0.88" />
              </>
            ) : null}
          </linearGradient>
          <radialGradient
            id={revealId}
            gradientUnits="userSpaceOnUse"
            r="28%"
            cx={mask.cx}
            cy={mask.cy}
          >
            <stop offset="0%" stopColor="#fff" />
            <stop offset="60%" stopColor="#fff" />
            <stop offset="100%" stopColor="#000" />
          </radialGradient>
          <mask id={maskId}>
            <rect x="0" y="0" width="100%" height="100%" fill={`url(#${revealId})`} />
          </mask>
        </defs>
        <text
          className="hero-hover-ghost"
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
        >
          {text}
        </text>
        <text
          className="hero-hover-outline"
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
        >
          {text}
        </text>
        <text
          className="hero-hover-glow"
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          fill={`url(#${gradientId})`}
          stroke={`url(#${gradientId})`}
          mask={`url(#${maskId})`}
        >
          {text}
        </text>
      </svg>
    </span>
  );
}
