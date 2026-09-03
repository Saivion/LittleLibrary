
"use client";

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
} from "react";
import { AgentFigure } from "@/components/AgentFigure";
import { CarryCard } from "@/components/CarryCard";
import { HeroHoverText } from "@/components/HeroHoverText";
import { CanvasViewport } from "@/components/CanvasViewport";
import { IconSamples, IconUpload } from "@/components/DockIcons";
import { InspectModal } from "@/components/InspectModal";
import { IntakeStack } from "@/components/IntakeStack";
import { RiverDither } from "@/components/RiverDither";
import { setViewportSize } from "@/lib/camera";
import { getCarrySnapshot, getServerCarrySnapshot, subscribeCarry } from "@/lib/carry";
import { ingestFiles } from "@/lib/ingest";
import { installInteraction } from "@/lib/interaction";
import { fileBatchKey, snapshotFiles } from "@/lib/parse";
import { count } from "@/lib/perf";
import { createSampleFiles } from "@/lib/samples";
import {
  getClip,
  getCurating,
  getIntakeServerSnapshot,
  getIntakeSnapshot,
  getServerCurating,
  getTile,
  reserveSampleHomes,
  subscribeAgent,
  subscribeDoc,
  subscribeIntake,
  tileCount,
} from "@/lib/store";
import { installDevHarness } from "@/lib/stress";
import { closeTile, getOpenId, getServerOpenId, subscribeUi } from "@/lib/ui";
import { registerPlaneTools } from "@/lib/webmcp";

/**
 * Intake pile, the card in the agent's hand, and the hand itself. Re-renders
 * only on intake / agent / carry slice changes; per-frame motion is written
 * to the DOM by lib/hand.ts and lib/carry.ts.
 */
const IntakeLayer = memo(function IntakeLayer() {
  count("intake");
  const intake = useSyncExternalStore(subscribeIntake, getIntakeSnapshot, getIntakeServerSnapshot);
  const curating = useSyncExternalStore(subscribeAgent, getCurating, getServerCurating);
  const carry = useSyncExternalStore(subscribeCarry, getCarrySnapshot, getServerCarrySnapshot);
  const held = carry.heldId ? getClip(carry.heldId) ?? null : null;
  return (
    <>
      <IntakeStack
        clips={intake.staged}
        curatingId={curating?.id}
        curatingPhase={curating?.phase}
        heldId={carry.heldId}
      />
      <CarryCard clip={held} />
      <AgentFigure curating={curating} waiting={!curating && intake.staged.length > 0} />
    </>
  );
});

/** Inspector. Subscribes to the UI store; nothing else re-renders on open. */
const InspectLayer = memo(function InspectLayer() {
  const openId = useSyncExternalStore(subscribeUi, getOpenId, getServerOpenId);
  const tile = openId ? getTile(openId) : undefined;
  if (!tile) return null;
  return <InspectModal tile={tile} onClose={closeTile} />;
});

function readHasTiles() {
  return tileCount() > 0;
}

function readIsCurating() {
  return getCurating() !== null;
}

function readIsInspecting() {
  return getOpenId() !== null;
}

function readFalse() {
  return false;
}

export function PlaneApp() {
  count("app");
  const sceneRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const marqueeRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [sampleBusy, setSampleBusy] = useState(false);
  const pickerBatch = useRef({ key: "", at: 0 });

  // Shell-level booleans only; each is a primitive so unrelated slice
  // changes (a tile moving, a clip arriving) don't re-render the shell.
  const hasTiles = useSyncExternalStore(subscribeDoc, readHasTiles, readFalse);
  const intakeLive = useSyncExternalStore(
    subscribeIntake,
    () => {
      const snap = getIntakeSnapshot();
      return snap.staged.length > 0 || snap.pending > 0 || snap.parsing;
    },
    readFalse,
  );
  const isCurating = useSyncExternalStore(subscribeAgent, readIsCurating, readFalse);
  const isInspecting = useSyncExternalStore(subscribeUi, readIsInspecting, readFalse);

  /**
   * Pointer, wheel and keyboard handling live outside React (lib/interaction):
   * pan, tile drag, marquee and zoom write to stores or the DOM directly, and
   * coalesce to one rAF. No React state changes at pointermove frequency.
   */
  useEffect(() => {
    const scene = sceneRef.current;
    const marquee = marqueeRef.current;
    if (!scene || !marquee) return;
    setViewportSize(window.innerWidth, window.innerHeight);
    const onResize = () => setViewportSize(window.innerWidth, window.innerHeight);
    window.addEventListener("resize", onResize);
    const stopTools = registerPlaneTools();
    const stopInteraction = installInteraction(scene, marquee);
    if (process.env.NODE_ENV !== "production") installDevHarness();
    return () => {
      window.removeEventListener("resize", onResize);
      stopTools();
      stopInteraction();
    };
  }, []);

  const onDragOver = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      if (!hover) setHover(true);
    },
    [hover],
  );

  const onDragLeave = useCallback((event: DragEvent) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setHover(false);
  }, []);

  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault();
    setHover(false);
    const files = snapshotFiles(event.dataTransfer.files);
    const key = fileBatchKey(files);
    if (
      key &&
      key === pickerBatch.current.key &&
      Date.now() - pickerBatch.current.at < 1000
    ) {
      return;
    }
    if (files.length) void ingestFiles(files);
  }, []);

  const openUpload = () => {
    const input = inputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  };

  const loadSamples = async () => {
    if (sampleBusy) return;
    setSampleBusy(true);
    try {
      reserveSampleHomes();
      await ingestFiles(await createSampleFiles());
    } finally {
      setSampleBusy(false);
    }
  };

  const started = hasTiles || intakeLive || sampleBusy;
  const empty = !started;

  return (
    <div
      ref={sceneRef}
      className={`scene${hover ? " is-hover" : ""}${empty ? " is-empty" : ""}${
        isCurating ? " is-curating" : ""
      }${isInspecting ? " is-inspecting" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <RiverDither />
      <IntakeLayer />
      <CanvasViewport />
      <div ref={marqueeRef} className="marquee" aria-hidden="true" />
      {empty ? (
        <section className="hero">
          <div className="hero-copy">
            <h1 className="hero-title">LittleLibrary</h1>
            <p className="hero-riff">
              <button
                type="button"
                className="hero-link"
                aria-label="Drop files"
                onClick={openUpload}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <HeroHoverText text="Drop files" />
              </button>
              <span className="hero-mute"> or </span>
              <button
                type="button"
                className="hero-link"
                aria-label="Load sample files"
                disabled={sampleBusy}
                onClick={() => void loadSamples()}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <HeroHoverText text={sampleBusy ? "loading samples" : "try the samples"} />
              </button><span className="hero-mute">,</span>
            </p>
            <p className="hero-riff hero-riff-rest">
              Watch the WebMCP agent
              <br />
              organize your files by topic.
            </p>
            <p className="hero-note">
              For demo purposes, no data will be kept or
              stored.
            </p>
          </div>
        </section>
      ) : (
        <div className="upload-dock is-rail">
          <div className="upload-actions">
            <button
              type="button"
              className="upload-button"
              aria-label="Upload files"
              onClick={openUpload}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <IconUpload />
              <span className="rail-tip" aria-hidden="true">Drop files</span>
            </button>
            <button
              type="button"
              className="upload-button is-quiet"
              aria-label="Load sample files"
              disabled={sampleBusy}
              onClick={() => void loadSamples()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <IconSamples />
              <span className="rail-tip" aria-hidden="true">
                {sampleBusy ? "Loading samples" : "Try the samples"}
              </span>
            </button>
          </div>
        </div>
      )}
      <InspectLayer />
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.txt,.md,.markdown,image/*,video/*"
        className="file-input"
        onChange={(event) => {
          const files = snapshotFiles(event.target.files);
          event.target.value = "";
          pickerBatch.current = { key: fileBatchKey(files), at: Date.now() };
          if (files.length) void ingestFiles(files);
        }}
      />
    </div>
  );
}
