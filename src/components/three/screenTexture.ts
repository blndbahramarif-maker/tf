import { CanvasTexture, SRGBColorSpace } from "three";

/**
 * Procedurally draws an abstract "app home screen" onto an offscreen 2D
 * canvas and returns it as a Three.js texture. No image assets required —
 * keeps the bundle small and lets the screen glow tint the phone's
 * surrounding materials via emissive lighting.
 */
export function createScreenTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    const tex = new CanvasTexture(canvas);
    return tex;
  }

  // Background gradient: brand purple -> accent orange glow -> teal
  const bg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  bg.addColorStop(0, "#4a17cc");
  bg.addColorStop(0.55, "#6d3ffb");
  bg.addColorStop(1, "#0fb8ab");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Soft glow blob (like a light source behind the UI)
  const glow = ctx.createRadialGradient(
    canvas.width * 0.5,
    canvas.height * 0.32,
    10,
    canvas.width * 0.5,
    canvas.height * 0.32,
    canvas.width * 0.6
  );
  glow.addColorStop(0, "rgba(255,255,255,0.35)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Status bar
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "600 22px system-ui, sans-serif";
  ctx.fillText("9:41", 36, 56);
  ctx.fillRect(canvas.width - 96, 34, 60, 18);

  // App icon grid
  const cols = 4;
  const rows = 5;
  const margin = 46;
  const gap = 20;
  const cellW = (canvas.width - margin * 2 - gap * (cols - 1)) / cols;
  const startY = 150;
  const iconColors = ["#ffffff", "#ffe9d3", "#c9befd", "#bff5ee", "#ffffff", "#ffd9c2"];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = margin + col * (cellW + gap);
      const y = startY + row * (cellW + gap + 30);
      const radius = 22;
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + cellW, y, x + cellW, y + cellW, radius);
      ctx.arcTo(x + cellW, y + cellW, x, y + cellW, radius);
      ctx.arcTo(x, y + cellW, x, y, radius);
      ctx.arcTo(x, y, x + cellW, y, radius);
      ctx.closePath();
      ctx.fillStyle = `${iconColors[(row * cols + col) % iconColors.length]}22`;
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.beginPath();
      ctx.arc(x + cellW / 2, y + cellW / 2, cellW * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Dock bar at the bottom
  const dockY = canvas.height - 130;
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  const dockRadius = 34;
  const dockX = margin - 10;
  const dockW = canvas.width - (margin - 10) * 2;
  const dockH = 100;
  ctx.beginPath();
  ctx.moveTo(dockX + dockRadius, dockY);
  ctx.arcTo(dockX + dockW, dockY, dockX + dockW, dockY + dockH, dockRadius);
  ctx.arcTo(dockX + dockW, dockY + dockH, dockX, dockY + dockH, dockRadius);
  ctx.arcTo(dockX, dockY + dockH, dockX, dockY, dockRadius);
  ctx.arcTo(dockX, dockY, dockX + dockW, dockY, dockRadius);
  ctx.closePath();
  ctx.fill();

  for (let i = 0; i < 4; i++) {
    const cx = dockX + dockW * ((i + 0.5) / 4);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(cx, dockY + dockH / 2, 26, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
