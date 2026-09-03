
"use client";

import { memo, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { bindSectionWriter, getSections, getServerSections, subscribeSections } from "@/lib/sections";

/**
 * Soft tinted regions around each topic cluster with a small label. One SVG,
 * one group per topic. During a drag, the moving cell's fill is translated
 * with the card so the pad does not stay behind.
 */
export const SectionLayer = memo(function SectionLayer() {
  const sections = useSyncExternalStore(subscribeSections, getSections, getServerSections);
  const groups = useRef(new Map<string, SVGGElement>());

  useLayoutEffect(() => {
    const map = groups.current;
    const reset = (group: SVGGElement) => {
      group.querySelector<SVGPathElement>('[data-part="base"]')?.removeAttribute("visibility");
      const stay = group.querySelector<SVGPathElement>('[data-part="stay"]');
      const move = group.querySelector<SVGPathElement>('[data-part="move"]');
      const label = group.querySelector<SVGTextElement>("text");
      stay?.setAttribute("visibility", "hidden");
      stay?.removeAttribute("d");
      move?.setAttribute("visibility", "hidden");
      move?.removeAttribute("d");
      move?.removeAttribute("transform");
      label?.removeAttribute("transform");
    };
    bindSectionWriter((payload) => {
      if (!payload) {
        for (const group of map.values()) reset(group);
        return;
      }
      const touched = new Set(payload.splits.map((split) => split.topic));
      for (const [topic, group] of map) {
        if (!touched.has(topic)) reset(group);
      }
      for (const split of payload.splits) {
        const group = map.get(split.topic);
        if (!group) continue;
        const base = group.querySelector<SVGPathElement>('[data-part="base"]');
        const stay = group.querySelector<SVGPathElement>('[data-part="stay"]');
        const move = group.querySelector<SVGPathElement>('[data-part="move"]');
        const label = group.querySelector<SVGTextElement>("text");
        base?.setAttribute("visibility", "hidden");
        if (stay) {
          if (split.stayD) {
            stay.setAttribute("d", split.stayD);
            stay.removeAttribute("visibility");
          } else {
            stay.setAttribute("visibility", "hidden");
          }
        }
        if (move) {
          move.setAttribute("d", split.moveD);
          move.removeAttribute("visibility");
          move.setAttribute("transform", `translate(${payload.dx} ${payload.dy})`);
        }
        if (label) {
          if (split.labelMoves) label.setAttribute("transform", `translate(${payload.dx} ${payload.dy})`);
          else label.removeAttribute("transform");
        }
      }
    });
    return () => bindSectionWriter(null);
  }, []);

  if (!sections.length) return null;
  return (
    <svg className="sections" aria-hidden="true">
      {sections.map((section) => (
        <g
          key={section.topic}
          ref={(node) => {
            if (node) groups.current.set(section.topic, node);
            else groups.current.delete(section.topic);
          }}
          className="section"
          data-topic={section.topic}
          style={{ ["--section-hue" as string]: section.hue }}
        >
          <path className="section-fill" data-part="base" d={section.d} />
          <path className="section-fill" data-part="stay" visibility="hidden" />
          <path className="section-fill" data-part="move" visibility="hidden" />
          <text className="section-label" x={section.labelX} y={section.labelY}>
            {section.topic.replace(/-/g, " ")}
            {section.count > 1 ? ` · ${section.count}` : ""}
          </text>
        </g>
      ))}
    </svg>
  );
});
