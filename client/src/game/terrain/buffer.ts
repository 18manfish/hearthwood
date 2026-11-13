// A growing list of coloured triangles: what the terrain builders write into.
// Plain arrays, no three.js, so the geometry can be built and checked anywhere.

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export class MeshBuffer {
  readonly pos: number[] = [];
  readonly col: number[] = [];

  tri(a: number[], b: number[], d: number[], color: RGB) {
    this.pos.push(...a, ...b, ...d);
    for (let i = 0; i < 3; i++) this.col.push(color.r, color.g, color.b);
  }

  quad(a: number[], b: number[], cc: number[], d: number[], color: RGB) {
    this.tri(a, b, cc, color);
    this.tri(a, cc, d, color);
  }
}
