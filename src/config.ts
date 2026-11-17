// Every tuning value, from data/config.json: each with value, min, max and step. The game reads
// them live through `tune.<name>` so the tweak panel's moves show at once. The tweak panel is on
// the dev server only: no build has it.
import data from '../data/config.json';

/** One tunable value with its slider range. */
export interface Knob { value: number; min: number; max: number; step: number }

type Data = typeof data;
/** The names of the tunable values (every key but the seed). */
export type KnobName = Exclude<keyof Data, 'seed'>;

/** The live config, the same object the tweak panel writes to. */
export const CONFIG = data as Data & Record<string, Knob | number>;
(window as unknown as { CONFIG: unknown }).CONFIG = CONFIG;

/** Live reads: tune.walkSpeed is CONFIG.walkSpeed.value; tune[name] reads a computed name. */
export const tune = new Proxy({} as Record<KnobName | string, number>, {
  get: (_, k: string) => (CONFIG[k] as Knob).value,
});

if (import.meta.env.DEV) await import('./dev/tune');
