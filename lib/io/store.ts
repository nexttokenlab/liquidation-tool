// State persistence: one JSON file. Swap this module for SQLite or KV if deploying.
import { promises as fs } from 'fs';
import path from 'path';
import type { State } from '../engine/types';

const FILE = path.join(process.cwd(), 'data', 'state.json');

export async function loadState(): Promise<State | null> {
  try { return JSON.parse(await fs.readFile(FILE, 'utf8')) as State; } catch { return null; }
}
export async function saveState(s: State) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(s));
}
export async function clearState() {
  try { await fs.unlink(FILE); } catch { /* nothing to clear */ }
}
export async function readSample(name: string) {
  return fs.readFile(path.join(process.cwd(), 'data', 'sample', name), 'utf8');
}
