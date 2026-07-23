import { Container } from 'pixi.js';

/** Pan/zoom camera applied to the world container. */
export class Camera {
  scale = 1;
  x = 0;
  y = 0;

  constructor(private world: Container) {}

  apply(): void {
    this.world.scale.set(this.scale);
    this.world.position.set(this.x, this.y);
  }

  panBy(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    this.apply();
  }

  /** Zoom keeping the given screen point fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const next = Math.max(0.35, Math.min(2.5, this.scale * factor));
    const k = next / this.scale;
    this.x = sx - (sx - this.x) * k;
    this.y = sy - (sy - this.y) * k;
    this.scale = next;
    this.apply();
  }

  screenToWorldPoint(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.x) / this.scale, y: (sy - this.y) / this.scale };
  }
}
