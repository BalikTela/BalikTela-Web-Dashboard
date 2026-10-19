import type { StakeholderType } from '../types.js';

export const stakeholderGroups = [
  { id: 'producers', label: 'Producers' },
  { id: 'consumers', label: 'Consumers & Recyclers' },
  { id: 'hubs', label: 'BalikTela Hubs' },
] as const;
export type StakeholderGroup = typeof stakeholderGroups[number]['id'];

export function stakeholderGroupFor(type: StakeholderType): StakeholderGroup | null {
  return type === 'Producer' ? 'producers' : type === 'Consumer' || type === 'Recycler' ? 'consumers' : type === 'BalikTela Hub' ? 'hubs' : null;
}
