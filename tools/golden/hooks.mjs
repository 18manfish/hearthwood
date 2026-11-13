// Node module hooks for the golden tests: route `three` and its add-ons to the fakes.
const here = new URL('./', import.meta.url);
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: new URL('fake-three.mjs', here).href, shortCircuit: true };
  if (spec.startsWith('three/')) return { url: new URL('fake-three-addons.mjs', here).href, shortCircuit: true };
  return next(spec, ctx);
}
