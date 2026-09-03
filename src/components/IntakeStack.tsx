
"use client";

import { memo } from "react";
import { registerIntakeCard, registerIntakeStack } from "@/lib/carry";
import { intakeScatter } from "@/lib/intakeScatter";
import { INTAKE_CARD_W, intakeFit, mediaKind, tileBox } from "@/lib/media";
import { count } from "@/lib/perf";
import type { AgentPhase, Clip } from "@/lib/types";
import { TileFace, faceVars } from "./TileFace";

type Props = {
  clips: Clip[];
  curatingId?: string;
  curatingPhase?: AgentPhase;
  /** Clip currently drawn by the card in the agent's hand (hidden here). */
  heldId: string | null;
};

/** Only this many cards are drawn; deeper ones would be fully hidden anyway. */
const VISIBLE = 6;

/**
 * The intake pile. Each card is the full tile face at world size, scaled to
 * one shared width, so the hand picks up exactly the card the pile shows.
 * Cards are positioned by CSS vars (`--cx/--cy` centre, `--fit` scale,
 * `--layer` depth, `--rot`) with transform-origin 0 0, which is what lets
 * the flight controller read a card's exact on-screen quad from its live
 * transform.
 */
function IntakeStackInner({ clips, curatingId, curatingPhase, heldId }: Props) {
  count("intake");
  // The card in the hand leaves the pile the moment the ghost takes it
  // (heldId). It stays out for the rest of the step; by the time the ghost
  // hands off to the wall, place_tile has removed it from `clips` anyway.
  const lifting = curatingPhase === "grab" || curatingPhase === "carry" || curatingPhase === "place";
  const liftId = heldId ?? (lifting ? curatingId : undefined);
  const liftIndex = liftId ? clips.findIndex((clip) => clip.id === liftId) : -1;

  const shown = clips.slice(0, VISIBLE + (liftIndex >= 0 ? 1 : 0));
  if (!shown.length) return null;

  return (
    <div className="intake-stack" ref={registerIntakeStack} aria-hidden="true">
      {shown.map((card, index) => {
        const isLift = index === liftIndex;
        // Visual position ignores the lifted card so the pile settles up as
        // soon as the hand takes the top card, not after place_tile returns.
        const layer = liftIndex >= 0 && index > liftIndex ? index - 1 : index;
        if (!isLift && layer >= VISIBLE) return null;
        const front = layer === 0;
        const scatter = intakeScatter(card.id, front);
        const fit = intakeFit(card.mediaType);
        const box = tileBox(card.mediaType);
        const reaching = front && curatingId === card.id && curatingPhase === "reach";
        return (
          <article
            key={card.id}
            ref={(element) => registerIntakeCard(card.id, element)}
            className={`intake-card tile-face is-${mediaKind(card.mediaType)} is-in${front ? " is-front" : ""}${
              reaching ? " is-reaching" : ""
            }${isLift ? " is-held" : ""}`}
            style={{
              ...faceVars(card.mediaType, card.topic),
              zIndex: shown.length - index,
              ["--layer" as string]: layer,
              ["--fit" as string]: fit,
              ["--cx" as string]: `${INTAKE_CARD_W / 2 + scatter.ox}px`,
              ["--cy" as string]: `${(box.h * fit) / 2 + scatter.oy}px`,
              ["--rot" as string]: `${scatter.rot}deg`,
              animationDelay: isLift ? "0ms" : `${Math.min(layer, VISIBLE) * 45}ms`,
            }}
          >
            <TileFace
              title={card.title}
              excerpt={card.excerpt}
              imageUrl={card.imageUrl}
              mediaType={card.mediaType}
              topic={card.topic}
            />
          </article>
        );
      })}
    </div>
  );
}

export const IntakeStack = memo(IntakeStackInner);
