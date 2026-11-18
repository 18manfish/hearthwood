// A yes/no choice kept in this browser (the ⚙️ Options toggles). Off until the
// player chooses; where storage isn't available the choice just isn't kept.

export interface Remembered {
  get(): boolean;
  set(on: boolean): void;
}

export function remembered(key: string): Remembered {
  return {
    get() {
      try {
        return localStorage.getItem(key) === '1';
      } catch {
        return false;
      }
    },
    set(on) {
      try {
        localStorage.setItem(key, on ? '1' : '0');
      } catch { /* private mode etc. */ }
    },
  };
}
