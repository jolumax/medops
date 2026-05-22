// Impersonation utility — platform admin can "enter" an org to manage its data.
// State stored in localStorage for persistence across page reloads.
// A CustomEvent notifies React context of changes.

const ORG_ID_KEY  = 'medops_imp_org_id';
const ORG_OBJ_KEY = 'medops_imp_org';

export const getImpersonatedOrgId = (): string | null =>
  localStorage.getItem(ORG_ID_KEY);

export const setImpersonation = (org: { id: string; name: string } | null): void => {
  if (org) {
    localStorage.setItem(ORG_ID_KEY,  org.id);
    localStorage.setItem(ORG_OBJ_KEY, JSON.stringify(org));
  } else {
    localStorage.removeItem(ORG_ID_KEY);
    localStorage.removeItem(ORG_OBJ_KEY);
  }
  window.dispatchEvent(new CustomEvent('medops:impersonation', { detail: org }));
};

export const getImpersonatedOrg = (): { id: string; name: string } | null => {
  const raw = localStorage.getItem(ORG_OBJ_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
};
