export type { EditState } from '../state/types';
export { clone } from '../state/types';
import { hexToRgba } from '../engine/Renderer';
export function hexToRgbaSafe(h: string) { try { return hexToRgba(h || '#ffffff'); } catch { return [1, 1, 1, 1] as [number, number, number, number]; } }
