import React, { createContext, useContext, useState, useEffect } from 'react';
import { getImpersonatedOrg, setImpersonation } from '../utils/impersonation';
import type { Organization } from '../types/domain';

interface ImpersonationCtx {
  impersonatedOrg: Organization | null;
  startImpersonation: (org: Organization) => void;
  stopImpersonation:  () => void;
}

const ImpersonationContext = createContext<ImpersonationCtx>({
  impersonatedOrg:   null,
  startImpersonation: () => {},
  stopImpersonation:  () => {},
});

export const useImpersonation = () => useContext(ImpersonationContext);

export const ImpersonationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [impersonatedOrg, setOrg] = useState<Organization | null>(() => {
    // Hydrate from localStorage on first render
    const stored = getImpersonatedOrg();
    return stored ? (stored as Organization) : null;
  });

  // Listen for changes triggered from other tabs or utility calls
  useEffect(() => {
    const handler = (e: Event) => {
      const org = (e as CustomEvent).detail as Organization | null;
      setOrg(org);
    };
    window.addEventListener('medops:impersonation', handler);
    return () => window.removeEventListener('medops:impersonation', handler);
  }, []);

  const startImpersonation = (org: Organization) => {
    setImpersonation({ id: org.id, name: org.name });
    setOrg(org);
  };

  const stopImpersonation = () => {
    setImpersonation(null);
    setOrg(null);
  };

  return (
    <ImpersonationContext.Provider value={{ impersonatedOrg, startImpersonation, stopImpersonation }}>
      {children}
    </ImpersonationContext.Provider>
  );
};
