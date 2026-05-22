import { supabase } from '../lib/supabase';
import { auditService } from './auditService';
import { getImpersonatedOrgId } from '../utils/impersonation';
import type { Surgery, SurgeryStatus } from '../types/domain';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const SURGERY_SELECT = `
  *,
  surgeon:surgeons(id,full_name,specialty),
  hospital:hospitals(id,name),
  ars:ars(id,name),
  surgery_trays(tray:trays(*)),
  surgery_consumption(id)
`;

const ALLOWED_FIELDS: Array<keyof Surgery> = [
  'patient_name', 'surgery_date', 'surgeon_id', 'hospital_id',
  'operating_room', 'procedure_type', 'status', 'delivery_responsible', 'notes', 'ars_id',
];

async function restGet(
  table: string,
  queryParams: Record<string, string> = {},
  select = '*'
): Promise<Surgery[]> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || '';

  const params = new URLSearchParams();
  if (select) params.append('select', select);
  Object.entries(queryParams).forEach(([k, v]) => params.append(k, v));

  const url = `${SUPABASE_URL}/rest/v1/${table}${params.toString() ? `?${params.toString()}` : ''}`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) throw new Error(`REST ${res.status}: ${await res.text()}`);
  return res.json();
}

function pickAllowed(surgeryData: Partial<Surgery>): Partial<Surgery> {
  const clean: Partial<Surgery> = {};
  ALLOWED_FIELDS.forEach(field => {
    if (surgeryData[field] !== undefined) (clean as Record<string, unknown>)[field] = surgeryData[field];
  });
  return clean;
}

export const surgeryService = {
  async getAll(surgeonId: string | null = null): Promise<Surgery[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const orgOverride = getImpersonatedOrgId();
      let query = supabase
        .from('surgeries')
        .select(SURGERY_SELECT)
        .order('surgery_date', { ascending: true })
        .abortSignal(controller.signal);

      if (surgeonId)   query = query.eq('surgeon_id', surgeonId);
      if (orgOverride) query = query.eq('org_id', orgOverride);

      const { data, error } = await query;
      clearTimeout(timeout);
      if (error) throw error;
      return data;
    } catch (err) {
      clearTimeout(timeout);
      if ((err as Error).name === 'AbortError') {
        console.warn('surgeryService.getAll: timed out, falling back to REST...');
        const orgOverride2 = getImpersonatedOrgId();
        const params: Record<string, string> = { order: 'surgery_date.asc' };
        if (surgeonId)    params['surgeon_id'] = `eq.${surgeonId}`;
        if (orgOverride2) params['org_id']     = `eq.${orgOverride2}`;
        return restGet('surgeries', params, '*');
      }
      throw err;
    }
  },

  async getById(id: string): Promise<Surgery> {
    const { data, error } = await supabase
      .from('surgeries')
      .select(SURGERY_SELECT)
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async create(surgeryData: Partial<Surgery>, trayIds: string[] = []): Promise<Surgery> {
    const cleanData = pickAllowed(surgeryData);

    const { data: surgery, error } = await supabase
      .from('surgeries').insert(cleanData).select().single();
    if (error) throw error;

    if (trayIds.length > 0) {
      const links = trayIds.map(tray_id => ({ surgery_id: surgery.id, tray_id }));
      const { error: linkErr } = await supabase.from('surgery_trays').insert(links);
      if (linkErr) throw linkErr;
    }

    await auditService.log('SURGERY_CREATE', 'surgeries', surgery.id, { patient: cleanData.patient_name });
    return surgery;
  },

  async update(id: string, surgeryData: Partial<Surgery>, trayIds: string[] = []): Promise<Surgery> {
    const cleanData = pickAllowed(surgeryData);

    const { data: surgery, error } = await supabase
      .from('surgeries').update(cleanData).eq('id', id).select().single();
    if (error) throw error;

    await supabase.from('surgery_trays').delete().eq('surgery_id', id);
    if (trayIds.length > 0) {
      const links = trayIds.map(tray_id => ({ surgery_id: id, tray_id }));
      const { error: linkErr } = await supabase.from('surgery_trays').insert(links);
      if (linkErr) throw linkErr;
    }

    await auditService.log('SURGERY_UPDATE', 'surgeries', id, { patient: cleanData.patient_name });
    return surgery;
  },

  async updateStatus(id: string, status: SurgeryStatus): Promise<Surgery> {
    const { data, error } = await supabase
      .from('surgeries').update({ status }).eq('id', id).select().single();
    if (error) throw error;
    await auditService.log('SURGERY_STATUS_CHANGE', 'surgeries', id, { new_status: status });
    return data;
  },

  async updateDate(id: string, newDate: string): Promise<Surgery> {
    const { data, error } = await supabase
      .from('surgeries').update({ surgery_date: newDate }).eq('id', id).select().single();
    if (error) throw error;
    await auditService.log('SURGERY_DATE_CHANGE', 'surgeries', id, { new_date: newDate });
    return data;
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from('surgeries').delete().eq('id', id);
    if (error) throw error;
    await auditService.log('SURGERY_DELETE', 'surgeries', id, { note: 'Cirugía eliminada' });
  },

  async sendAlert(surgery: Surgery, recipientEmail: string): Promise<unknown> {
    // SECURITY F-16: send only the fields the send-surgery-alert Edge
    // Function actually consumes, instead of the full Surgery object
    // (data minimisation / least privilege).
    const hospital = (surgery as { hospital?: { name?: string } }).hospital;
    const surgeon = (surgery as { surgeon?: { full_name?: string } }).surgeon;
    const payload = {
      patient_name: surgery.patient_name,
      surgery_date: surgery.surgery_date,
      procedure_type: surgery.procedure_type,
      hospital: hospital ? { name: hospital.name } : null,
      surgeon: surgeon ? { full_name: surgeon.full_name } : null,
    };

    const { data, error } = await supabase.functions.invoke('send-surgery-alert', {
      body: { surgery: payload, recipientEmail },
    });
    if (error) throw error;
    return data;
  },
};
