export const WEB_DASHBOARD_ROLES = ['Administrator', 'Government', 'Researcher'] as const;
export const WEB_ACCESS_MESSAGE = 'Web dashboard access is limited to Admin, Government, and Researcher accounts. Use the mobile application for participant and Hub activities.';

export function isWebDashboardRole(role: string) {
  return (WEB_DASHBOARD_ROLES as readonly string[]).includes(role);
}

export const ACCOUNT_GROUPS = [
  { label: 'Admin', roles: ['Administrator'] },
  { label: 'Government', roles: ['Government'] },
  { label: 'Researcher', roles: ['Researcher'] },
  { label: 'Producer / Consumer', roles: ['Producer', 'Consumer', 'NGO'] },
  { label: 'Recycler / Hub', roles: ['Recycler', 'BalikTela Hub', 'Upcycler', 'LGU/Collection Point'] },
] as const;

export const ACCOUNT_ROLES = ['Administrator', 'Government', 'Researcher', 'Producer', 'Consumer', 'Recycler', 'BalikTela Hub'] as const;
export const accountRoleLabel = (role: string) => role === 'Administrator' ? 'Admin' : role;
export function accountGroup(role: string) {
  return ACCOUNT_GROUPS.find(group => (group.roles as readonly string[]).includes(role))?.label ?? 'Other';
}
