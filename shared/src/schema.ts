// A tiny, dependency-free runtime schema validator. Every message the server
// receives is parsed with these before any game logic sees it.

export class SchemaError extends Error {}

export type Parser<T> = (v: unknown, path: string) => T;

type Simplify<T> = { [K in keyof T]: T[K] } & {};
/** Object type where keys whose parser may yield `undefined` become optional. */
export type ObjOut<S extends Record<string, Parser<unknown>>> = Simplify<
  { [K in keyof S as undefined extends ReturnType<S[K]> ? never : K]: ReturnType<S[K]> } & {
    [K in keyof S as undefined extends ReturnType<S[K]> ? K : never]?: ReturnType<S[K]>;
  }
>;

const fail = (path: string, msg: string): never => {
  throw new SchemaError(`${path || 'value'}: ${msg}`);
};

export const s = {
  str(min = 0, max = 256, pattern?: RegExp): Parser<string> {
    return (v, p) => {
      if (typeof v !== 'string') return fail(p, 'expected string');
      if (v.length < min || v.length > max) return fail(p, `length must be ${min}-${max}`);
      if (pattern && !pattern.test(v)) return fail(p, 'invalid format');
      return v;
    };
  },
  num(min = -Infinity, max = Infinity): Parser<number> {
    return (v, p) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) return fail(p, 'expected finite number');
      if (v < min || v > max) return fail(p, `out of range ${min}..${max}`);
      return v;
    };
  },
  int(min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): Parser<number> {
    return (v, p) => {
      if (typeof v !== 'number' || !Number.isInteger(v)) return fail(p, 'expected integer');
      if (v < min || v > max) return fail(p, `out of range ${min}..${max}`);
      return v;
    };
  },
  bool(): Parser<boolean> {
    return (v, p) => (typeof v === 'boolean' ? v : fail(p, 'expected boolean'));
  },
  lit<T extends string | number>(value: T): Parser<T> {
    return (v, p) => (v === value ? value : fail(p, `expected ${String(value)}`));
  },
  oneOf<T extends string>(values: readonly T[]): Parser<T> {
    return (v, p) => (typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : fail(p, `expected one of ${values.join(',')}`));
  },
  /** Validate with a type guard (e.g. isItem). */
  guard<T>(g: (v: unknown) => v is T, what: string): Parser<T> {
    return (v, p) => (g(v) ? v : fail(p, `invalid ${what}`));
  },
  opt<T>(inner: Parser<T>): Parser<T | undefined> {
    return (v, p) => (v === undefined || v === null ? undefined : inner(v, p));
  },
  nullable<T>(inner: Parser<T>): Parser<T | null> {
    return (v, p) => (v === null ? null : inner(v, p));
  },
  arr<T>(inner: Parser<T>, max = 100): Parser<T[]> {
    return (v, p) => {
      if (!Array.isArray(v)) return fail(p, 'expected array');
      if (v.length > max) return fail(p, `too many items (max ${max})`);
      return v.map((x, i) => inner(x, `${p}[${i}]`));
    };
  },
  obj<S extends Record<string, Parser<unknown>>>(shape: S): Parser<ObjOut<S>> {
    return (v, p) => {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(p, 'expected object');
      const out: Record<string, unknown> = {};
      const src = v as Record<string, unknown>;
      // Unknown keys are dropped, never passed through.
      for (const key of Object.keys(shape)) out[key] = shape[key](src[key], p ? `${p}.${key}` : key);
      return out as ObjOut<S>;
    };
  },
  /** Discriminated union on a string key. */
  union<K extends string, M extends Record<string, Parser<unknown>>>(key: K, members: M): Parser<ReturnType<M[keyof M]>> {
    return (v, p) => {
      if (typeof v !== 'object' || v === null) return fail(p, 'expected object');
      const tag = (v as Record<string, unknown>)[key];
      if (typeof tag !== 'string' || !Object.prototype.hasOwnProperty.call(members, tag)) return fail(p, `unknown ${key}`);
      return members[tag](v, p) as ReturnType<M[keyof M]>;
    };
  },
};

export function parse<T>(parser: Parser<T>, v: unknown): T {
  return parser(v, '');
}
