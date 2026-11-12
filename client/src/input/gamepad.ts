// Gamepad support via the browser Gamepad API ("standard" mapping, which
// covers Xbox, PlayStation, Switch Pro and most generic controllers).
// Polls once per animation frame and turns raw state into edge-triggered
// button events plus analog stick values.

export type PadButton =
  | 'A' | 'B' | 'X' | 'Y' | 'LB' | 'RB' | 'LT' | 'RT' | 'SELECT' | 'START' | 'L3' | 'R3'
  | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'HOME';

// Standard mapping button indices.
const MAP: PadButton[] = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'SELECT', 'START', 'L3', 'R3', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'HOME'];

export interface PadState {
  /** Left stick (or D-pad), x right, y down, magnitude 0..1 after dead-zone. */
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  held: Set<PadButton>;
}

export interface PadHandlers {
  down(b: PadButton, s: PadState): void;
  up(b: PadButton, s: PadState): void;
  /** Directional "navigation" pulses (D-pad or stick), with key-repeat. */
  nav(dir: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT', s: PadState): void;
  frame(s: PadState, dt: number): void;
  connected(name: string): void;
  disconnected(): void;
}

const DEAD = 0.22;

function dead(v: number) {
  const a = Math.abs(v);
  if (a < DEAD) return 0;
  return Math.sign(v) * Math.min(1, (a - DEAD) / (1 - DEAD));
}

export class GamepadInput {
  private prev = new Set<PadButton>();
  private navDir: string | null = null;
  private navNext = 0;
  private last = performance.now();
  private index: number | null = null;
  active = false;

  constructor(private h: PadHandlers) {
    window.addEventListener('gamepadconnected', (e) => {
      this.index = e.gamepad.index;
      this.h.connected(e.gamepad.id);
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.index === e.gamepad.index) {
        this.index = null;
        this.active = false;
        this.h.disconnected();
      }
    });
    const loop = () => {
      this.poll();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private pad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    if (this.index !== null && pads[this.index]) return pads[this.index];
    for (const p of pads) if (p && p.connected) return (this.index = p.index), p;
    return null;
  }

  private poll() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const p = this.pad();
    if (!p) return;
    const held = new Set<PadButton>();
    p.buttons.forEach((b, i) => {
      if (MAP[i] && (b.pressed || b.value > 0.5)) held.add(MAP[i]);
    });
    let lx = dead(p.axes[0] ?? 0);
    let ly = dead(p.axes[1] ?? 0);
    const rx = dead(p.axes[2] ?? 0);
    const ry = dead(p.axes[3] ?? 0);
    // D-pad also steers.
    if (held.has('LEFT')) lx = -1;
    if (held.has('RIGHT')) lx = 1;
    if (held.has('UP')) ly = -1;
    if (held.has('DOWN')) ly = 1;
    const s: PadState = { lx, ly, rx, ry, held };
    if (held.size || lx || ly || rx || ry) this.active = true;

    for (const b of held) if (!this.prev.has(b)) this.h.down(b, s);
    for (const b of this.prev) if (!held.has(b)) this.h.up(b, s);
    this.prev = held;

    // Navigation pulses with key-repeat (350 ms delay, then every 130 ms).
    const dir = Math.abs(lx) > 0.6 || Math.abs(ly) > 0.6 ? (Math.abs(lx) > Math.abs(ly) ? (lx > 0 ? 'RIGHT' : 'LEFT') : ly > 0 ? 'DOWN' : 'UP') : null;
    if (dir !== this.navDir) {
      this.navDir = dir;
      if (dir) {
        this.h.nav(dir as 'UP', s);
        this.navNext = now + 350;
      }
    } else if (dir && now >= this.navNext) {
      this.h.nav(dir as 'UP', s);
      this.navNext = now + 130;
    }
    this.h.frame(s, dt);
  }
}
