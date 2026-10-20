export const REGISTRY_VERIFICATIONS = ['Pending review', 'Verified', 'Rejected', 'Suspended'] as const;
export const ORGANIZATION_STATUSES = ['Pending review', 'Active', 'Inactive'] as const;
export const ORGANIZATION_TYPES = ['Producer/Retailer', 'Recycler', 'Upcycler', 'NGO/Community', 'LGU/MRF', 'Collection point', 'School', 'Research institution', 'Government agency', 'Other'] as const;
export type OrganizationType = typeof ORGANIZATION_TYPES[number];
const legacyOrganizationTypes = new Map<string, OrganizationType>([
  ['Producer', 'Producer/Retailer'], ['NGO', 'NGO/Community'], ['LGU/Collection Point', 'LGU/MRF'],
  ['Research', 'Research institution'], ['Government', 'Government agency'],
]);

// Organizations describe institutions, not the roles or permissions of their users.
export function organizationType(value: unknown): OrganizationType | null {
  if (typeof value !== 'string') return null;
  const type = value.trim();
  return legacyOrganizationTypes.get(type) ?? ORGANIZATION_TYPES.find(item => item === type) ?? null;
}
export type RegistryVerification = typeof REGISTRY_VERIFICATIONS[number] | 'Pending demo review' | 'Demo verified';
export type OrganizationStatus = typeof ORGANIZATION_STATUSES[number] | 'Prospective sample' | 'Confirmed demo';

export function registryVerification(value: RegistryVerification): typeof REGISTRY_VERIFICATIONS[number] {
  return value === 'Demo verified' ? 'Verified' : value === 'Pending demo review' ? 'Pending review' : value;
}

export function organizationStatus(value: OrganizationStatus): typeof ORGANIZATION_STATUSES[number] {
  return value === 'Confirmed demo' ? 'Active' : value === 'Prospective sample' ? 'Pending review' : value;
}
