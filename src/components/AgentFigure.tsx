
"use client";

import { memo, useLayoutEffect, useRef } from "react";
import { getHand, subscribeHand } from "@/lib/hand";
import { count } from "@/lib/perf";
import type { AgentPhase, Curating } from "@/lib/types";

type Props = {
  curating: Curating | null;
  /** Cards are staged but the agent is between runs. */
  waiting: boolean;
};

function toolCopy(curating: Curating) {
  if (curating.tool === "get_occupancy") return "get_occupancy";
  if (curating.tool === "cluster_visible") return "cluster_visible";
  return "place_tile";
}

function pinNode(node: HTMLElement) {
  const pos = getHand();
  node.style.setProperty("--ax", `${pos.x}px`);
  node.style.setProperty("--ay", `${pos.y}px`);
  node.style.setProperty("--at", `${pos.rot}deg`);
}

function isClosed(phase: AgentPhase | "wait") {
  return phase === "grab" || phase === "carry";
}

function OpenHand() {
  return (
    <svg className="agent-cursor-svg" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
      <path
        d="M10.2 14.2V8.1c0-1.15.9-2.05 2.05-2.05S14.3 6.95 14.3 8.1v6.1M14.1 13.6V6.4c0-1.2.95-2.15 2.15-2.15S18.4 5.2 18.4 6.4v7.3M18.1 14V8.2c0-1.15.9-2.05 2.05-2.05S22.2 7.05 22.2 8.2V14.4M21.8 15.1v-2.6c0-1 .8-1.8 1.8-1.8s1.8.8 1.8 1.8V17.2c0 5.1-3.6 8.6-8.8 8.6h-2.6c-5.2 0-8.6-4-8.6-8.4 0-1.7 1.2-3 2.8-3 1 0 1.8.4 2.4 1.1"
        fill="#fff"
        stroke="#111"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClosedHand() {
  return (
    <svg className="agent-cursor-svg" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
      <path
        d="M9.4 15.2c0-1.15.95-2.1 2.1-2.1s2.1.95 2.1 2.1v1.1M13.4 14.2c0-1.2 1-2.2 2.2-2.2s2.2 1 2.2 2.2v1.4M17.6 14.4c0-1.15.95-2.1 2.1-2.1s2.1.95 2.1 2.1v1.5M21.4 15.6c0-1 .85-1.85 1.85-1.85S25.1 14.6 25.1 15.6v2.4c0 4.6-3.4 7.8-8.3 7.8h-2.4c-4.8 0-7.8-3.5-7.8-7.6 0-1.45 1.15-2.6 2.6-2.6.7 0 1.35.28 1.8.75"
        fill="#fff"
        stroke="#111"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AgentCursorMark({ phase }: { phase: AgentPhase | "wait" }) {
  return (
    <div className={`agent-cursor is-${isClosed(phase) ? "closed" : "open"}`} aria-hidden="true">
      <span className="agent-cursor-face is-open">
        <OpenHand />
      </span>
      <span className="agent-cursor-face is-shut">
        <ClosedHand />
      </span>
    </div>
  );
}

/**
 * The agent's hand and its tool label. Position is pinned to the hand store
 * through CSS vars on every hand emit: the reach ease and the flight
 * controller both move the hand, React only swaps the open/closed mark. The
 * card the hand carries is drawn by CarryCard, not here.
 */
function AgentFigureInner({ curating, waiting }: Props) {
  count("agent");
  const nodeRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const apply = () => {
      const node = nodeRef.current;
      if (node) pinNode(node);
    };
    apply();
    return subscribeHand(apply);
  }, [curating, waiting]);

  if (!curating && !waiting) return null;

  const phase = curating?.phase ?? "wait";
  const pos = getHand();

  return (
    <div
      ref={nodeRef}
      className={`agent-figure is-${phase}`}
      style={{
        ["--ax" as string]: `${pos.x}px`,
        ["--ay" as string]: `${pos.y}px`,
        ["--at" as string]: `${pos.rot}deg`,
      }}
      aria-live="polite"
    >
      <AgentCursorMark phase={phase} />
      <div className="agent-meta">
        <span className="agent-brand">WebMCP</span>
        <span className="agent-tool">{curating ? toolCopy(curating) : "waiting"}</span>
      </div>
    </div>
  );
}

export const AgentFigure = memo(AgentFigureInner);
