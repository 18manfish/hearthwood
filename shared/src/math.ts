// Small maths helpers shared by generation and rendering.


export function smoothstep(t: number) {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
}
