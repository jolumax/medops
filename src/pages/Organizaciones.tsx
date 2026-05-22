import React, { useEffect, useState } from 'react';
import { Building2, Plus, X, Copy, CheckCircle2, Power, Wrench } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../utils/cn';
import { useToast } from '../components/ui/Toast';
import { useImpersonation } from '../contexts/ImpersonationContext';
import { organizationService } from '../services/organizationService';
import type { Organization } from '../types/domain';

interface NewOrgForm {
  name: string;
  slug: string;
  admin_full_name: string;
  admin_email: string;
}

const EMPTY_FORM: NewOrgForm = { name: '', slug: '', admin_full_name: '', admin_email: '' };

export const Organizaciones: React.FC = () => {
  const toast = useToast();
  const navigate = useNavigate();
  const { startImpersonation } = useImpersonation();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<NewOrgForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [createdInfo, setCreatedInfo] = useState<{ email: string; tempPassword: string } | null>(null);

  const loadOrgs = async () => {
    setLoading(true);
    try {
      setOrgs(await organizationService.getAll());
    } catch (err) {
      console.error('Error cargando organizaciones:', err);
      toast.error('No se pudieron cargar las organizaciones.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadOrgs(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.admin_full_name || !form.admin_email) {
      toast.warning('Completa el nombre de la organización y los datos del administrador.');
      return;
    }
    setSaving(true);
    try {
      const result = await organizationService.createOrg({
        name: form.name.trim(),
        slug: form.slug.trim() || undefined,
        admin_full_name: form.admin_full_name.trim(),
        admin_email: form.admin_email.trim(),
      });
      setShowModal(false);
      setForm(EMPTY_FORM);
      setCreatedInfo({ email: result.admin.email, tempPassword: result.tempPassword });
      toast.success('Organización creada correctamente.');
      await loadOrgs();
    } catch (err) {
      console.error('Error creando organización:', err);
      const msg = err instanceof Error ? err.message : 'Error al crear la organización.';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (org: Organization) => {
    try {
      await organizationService.setActive(org.id, !org.is_active);
      toast.success(`Organización ${org.is_active ? 'desactivada' : 'activada'}.`);
      await loadOrgs();
    } catch (err) {
      console.error('Error actualizando organización:', err);
      toast.error('No se pudo actualizar la organización.');
    }
  };

  const copyPassword = (value: string) => {
    navigator.clipboard?.writeText(value);
    toast.info('Contraseña copiada al portapapeles.');
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center text-white shadow-lg shadow-primary/20">
            <Building2 size={26} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Organizaciones</h1>
            <p className="text-sm text-slate-500 font-medium">Gestión de tenants de la plataforma</p>
          </div>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-primary text-white px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-primary/20 hover:-translate-y-0.5 transition-transform"
        >
          <Plus size={18} /> Nueva Organización
        </button>
      </div>

      {createdInfo && (
        <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={20} className="text-emerald-600 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold text-emerald-800 text-sm">Organización creada</p>
              <p className="text-sm text-emerald-700 mt-1">
                Entrega estas credenciales al administrador <strong>{createdInfo.email}</strong>.
                Deberá cambiar la contraseña en el primer ingreso.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="bg-white border border-emerald-200 rounded-lg px-3 py-1.5 text-sm font-mono text-slate-800">
                  {createdInfo.tempPassword}
                </code>
                <button
                  onClick={() => copyPassword(createdInfo.tempPassword)}
                  className="text-emerald-600 hover:text-emerald-800 p-1.5 hover:bg-emerald-100 rounded-lg"
                >
                  <Copy size={16} />
                </button>
              </div>
            </div>
            <button onClick={() => setCreatedInfo(null)} className="text-emerald-600 hover:text-emerald-800">
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      ) : orgs.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Building2 size={40} className="mx-auto mb-3 opacity-40" />
          <p className="font-medium">No hay organizaciones todavía.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orgs.map((org) => (
            <div
              key={org.id}
              className="bg-white border border-slate-200 rounded-2xl p-5 flex items-center gap-4"
            >
              <div className="w-11 h-11 bg-slate-100 rounded-xl flex items-center justify-center text-slate-500">
                <Building2 size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-900 truncate">{org.name}</p>
                <p className="text-xs text-slate-500">
                  {org.slug ? `${org.slug} · ` : ''}
                  Creada {org.created_at ? new Date(org.created_at).toLocaleDateString('es-ES') : '—'}
                </p>
              </div>
              <span
                className={cn(
                  'text-[11px] font-bold px-2.5 py-1 rounded-full',
                  org.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'
                )}
              >
                {org.is_active ? 'Activa' : 'Inactiva'}
              </span>
              <button
                onClick={() => {
                  startImpersonation(org);
                  navigate('/');
                }}
                title="Entrar en modo mantenimiento"
                className="p-2 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
              >
                <Wrench size={18} />
              </button>
              <button
                onClick={() => handleToggleActive(org)}
                title={org.is_active ? 'Desactivar' : 'Activar'}
                className={cn(
                  'p-2 rounded-lg transition-colors',
                  org.is_active
                    ? 'text-slate-400 hover:text-red-500 hover:bg-red-50'
                    : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'
                )}
              >
                <Power size={18} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-black text-slate-900">Nueva Organización</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <Field label="Nombre de la organización *">
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="input"
                  placeholder="Clínica Ortopédica del Este"
                />
              </Field>
              <Field label="Slug (opcional)">
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
                  className="input"
                  placeholder="clinica-este"
                />
              </Field>
              <div className="border-t border-slate-100 pt-4">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
                  Primer Administrador
                </p>
                <Field label="Nombre completo *">
                  <input
                    type="text"
                    value={form.admin_full_name}
                    onChange={(e) => setForm({ ...form, admin_full_name: e.target.value })}
                    className="input"
                    placeholder="Dr. Juan Pérez"
                  />
                </Field>
                <div className="mt-3">
                  <Field label="Correo electrónico *">
                    <input
                      type="email"
                      value={form.admin_email}
                      onChange={(e) => setForm({ ...form, admin_email: e.target.value })}
                      className="input"
                      placeholder="admin@clinica.com"
                    />
                  </Field>
                </div>
              </div>
              <button
                type="submit"
                disabled={saving}
                className={cn(
                  'w-full bg-primary text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-primary/20 transition-all',
                  saving ? 'opacity-70 cursor-wait' : 'hover:-translate-y-0.5'
                )}
              >
                {saving ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>Crear Organización</>
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">
      {label}
    </label>
    {children}
  </div>
);
