"use client";

import { useEffect, useRef } from "react";

const clamp = (value: number) => Math.min(1, Math.max(0, value));

const hash = (x: number, y: number) => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return value - Math.floor(value);
};

const DITHER_STEP = 3;

const drawDither = (canvas: HTMLCanvasElement) => {
  const { height, width } = canvas.getBoundingClientRect();
  if (!height || !width) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.ceil(width * pixelRatio);
  canvas.height = Math.ceil(height * pixelRatio);

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = `rgb(${
    getComputedStyle(canvas).getPropertyValue("--workspace-dither-dot-rgb").trim() ||
    "255, 255, 255"
  })`;

  const columns = Math.ceil(width / DITHER_STEP);
  const rows = Math.ceil(height / DITHER_STEP);

  for (let row = 0; row <= rows; row++) {
    const y = row * DITHER_STEP;
    const vertical = row / rows;

    for (let column = 0; column <= columns; column++) {
      const x = column * DITHER_STEP;
      const horizontal = column / columns;
      const bottomLeftToTopRight = clamp((1 - horizontal + vertical) / 2);
      const contour =
        Math.sin(horizontal * 13.5 + vertical * 6.5) * 0.09 +
        Math.sin(horizontal * 5.5 - vertical * 15) * 0.055;
      const density = clamp(Math.pow(bottomLeftToTopRight, 1.28) + contour);
      const threshold = density * 1.02 - 0.08;

      if (hash(column, row) > threshold) continue;

      const jitter = hash(column + 53, row + 97);
      const radius = 0.12 + Math.pow(density, 1.35) * (0.42 + jitter * 0.1);

      context.globalAlpha = 0.032 + Math.pow(density, 1.18) * 0.185;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
  }
};

export const WorkspaceDitherBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => drawDither(canvas);
    const resizeObserver = new ResizeObserver(draw);

    draw();
    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, []);

  return (
    <canvas
      className="pointer-events-none absolute inset-0 z-0 size-full overflow-hidden"
      ref={canvasRef}
    />
  );
};
