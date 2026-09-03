"use client";

import { memo, useLayoutEffect, useRef } from "react";

const BAYER = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

const ORANGE = [232, 96, 46];
const RED = [196, 38, 72];
const PURPLE = [108, 42, 128];
const PINK = [236, 118, 168];
const FOAM = [255, 196, 156];
const WAVE = 2400;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function mixRgb(a: number[], b: number[], t: number) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function paint(image: ImageData, width: number, height: number) {
  const data = image.data;
  const t = WAVE * 0.00042;
  for (let y = 0; y < height; y++) {
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      const bank =
        0.18 +
        Math.sin(nx * Math.PI * 2 + t * 0.55) * 0.14 +
        Math.sin(nx * 9.2 + t * 0.28) * 0.05 +
        Math.sin(nx * 21 - t * 0.4) * 0.02;
      const current =
        Math.sin(nx * 11 + t * 1.4 + ny * 6) * 0.06 +
        Math.sin(nx * 24 - t * 1.1 + ny * 3.2) * 0.035;
      const braid = Math.sin(ny * 22 + nx * 7 - t * 1.8) * 0.04;
      const depth = (ny - bank) / Math.max(0.12, 1 - bank);
      const density = depth + current + braid;
      const threshold = BAYER[y & 7][x & 7] / 64;
      const i = (y * width + x) * 4;
      if (density <= threshold) {
        data[i + 3] = 0;
        continue;
      }
      const wet = Math.min(1, (density - threshold) * 1.7);
      const shade = Math.min(1, Math.max(0, depth * 0.95 + current * 0.8));
      let phase = nx + t * 0.06 + current * 0.35;
      phase -= Math.floor(phase);
      let body: number[];
      if (phase < 0.25) body = mixRgb(ORANGE, RED, phase / 0.25);
      else if (phase < 0.5) body = mixRgb(RED, PINK, (phase - 0.25) / 0.25);
      else if (phase < 0.75) body = mixRgb(PINK, PURPLE, (phase - 0.5) / 0.25);
      else body = mixRgb(PURPLE, ORANGE, (phase - 0.75) / 0.25);
      body = mixRgb(body, mixRgb(ORANGE, PURPLE, shade), shade * 0.28);
      const [r, g, b] = mixRgb(FOAM, body, wet);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = Math.round(lerp(50, 235, Math.min(1, Math.max(0, depth * 1.2))));
    }
  }
}

let cache: { w: number; h: number; pixels: ImageData } | null = null;

function sizeForView() {
  return {
    w: Math.max(160, Math.floor(window.innerWidth / 2.4)),
    h: Math.max(80, Math.floor((window.innerHeight * 0.46) / 2.4)),
  };
}

function blit(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, w: number, h: number) {
  if (cache && cache.w === w && cache.h === h) {
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.putImageData(cache.pixels, 0, 0);
    return;
  }
  canvas.width = w;
  canvas.height = h;
  const image = ctx.createImageData(w, h);
  paint(image, w, h);
  ctx.putImageData(image, 0, 0);
  cache = { w, h, pixels: image };
}

function RiverDitherInner() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let width = 0;
    let height = 0;

    const draw = () => {
      const { w, h } = sizeForView();
      if (w === width && h === height) return;
      width = w;
      height = h;
      blit(ctx, canvas, w, h);
      canvas.classList.add("is-ready");
    };

    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, []);

  return (
    <div className="river-wrap" aria-hidden="true">
      <canvas ref={canvasRef} className="river" />
    </div>
  );
}

export const RiverDither = memo(RiverDitherInner);
