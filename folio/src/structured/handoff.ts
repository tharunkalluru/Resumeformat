/** A resume passed from the exact-layout workspace to the main one: just its name and words. */
export interface Handoff { name: string; text: string; pages?: number | null; note?: string }
let pending: Handoff | null = null;
export const setHandoff = (value: Handoff) => { pending = value; };
export const takeHandoff = (): Handoff | null => { const value = pending; pending = null; return value; };
