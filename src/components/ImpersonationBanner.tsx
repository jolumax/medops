import React from 'react';
import { Building2, X, ShieldAlert } from 'lucide-react';
import { useImpersonation } from '../contexts/ImpersonationContext';
import { useNavigate } from 'react-router-dom';

export const ImpersonationBanner: React.FC = () => {
  const { impersonatedOrg, stopImpersonation } = useImpersonation();
  const navigate = useNavigate();

  if (!impersonatedOrg) return null;

  return (
    <div className="bg-violet-600 text-white px-4 py-2.5 flex items-center justify-between text-sm sticky top-0 z-50 shadow-lg shadow-violet-600/20">
      <div className="flex items-center gap-2">
        <ShieldAlert size={16} className="shrink-0" />
        <span className="font-semibold hidden sm:inline">Modo Mantenimiento —</span>
        <Building2 size={15} className="shrink-0" />
        <span className="font-bold">{impersonatedOrg.name}</span>
        <span className="text-violet-300 text-xs hidden sm:inline">
          (ves y editas datos de esta organización)
        </span>
      </div>
      <button
        onClick={() => {
          stopImpersonation();
          navigate('/organizaciones');
        }}
        className="flex items-center gap-1.5 bg-violet-700 hover:bg-violet-800 px-3 py-1.5 rounded-lg transition-colors text-xs font-bold ml-4 shrink-0"
      >
        <X size={13} /> Salir
      </button>
    </div>
  );
};
