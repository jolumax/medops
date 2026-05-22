import { supabase } from '../lib/supabase';
import { getLocalDateString } from '../utils/dateUtils';
import { getImpersonatedOrgId } from '../utils/impersonation';
import type { Tray, TrayWithAvailability, MaintenanceLog } from '../types/domain';

type TrayInput = Partial<Tray> & {
  surgery_trays?: unknown;
  usage_count?: number;
};

function cleanTrayPayload(tray: TrayInput): Omit<TrayInput, 'surgery_trays' | 'usage_count'> {
  const { surgery_trays: _st, usage_count: _uc, ...clean } = tray;
  if (clean.last_sterilization === '') clean.last_sterilization = null;
  if (clean.next_maintenance === '') clean.next_maintenance = null;
  return clean;
}

export const trayService = {
  async getAll(): Promise<Tray[]> {
    const orgOverride = getImpersonatedOrgId();
    let query = supabase.from('trays').select('*, surgery_trays(count)').order('name');
    if (orgOverride) query = query.eq('org_id', orgOverride);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((t: Tray & { surgery_trays?: Array<{ count: number }> }) => ({
      ...t,
      usage_count: t.surgery_trays?.[0]?.count || 0,
    }));
  },

  async create(tray: TrayInput): Promise<Tray> {
    const { data, error } = await supabase
      .from('trays').insert(cleanTrayPayload(tray)).select().single();
    if (error) throw error;
    return data;
  },

  async update(id: string, tray: TrayInput): Promise<Tray> {
    const { data, error } = await supabase
      .from('trays').update(cleanTrayPayload(tray)).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from('trays').delete().eq('id', id);
    if (error) throw error;
  },

  async getAvailableForDate(
    date: Date | string,
    excludeSurgeryId: string | null = null
  ): Promise<TrayWithAvailability[]> {
    const dateStr = getLocalDateString(date instanceof Date ? date : new Date(date));

    let query = supabase
      .from('surgery_trays')
      .select('tray_id, surgery:surgeries!inner(id, surgery_date)')
      .gte('surgeries.surgery_date', `${dateStr}T00:00:00`)
      .lte('surgeries.surgery_date', `${dateStr}T23:59:59`);

    if (excludeSurgeryId) {
      query = query.neq('surgeries.id', excludeSurgeryId);
    }

    const { data: busyLinks } = await query;
    const busyTrayIds: string[] = (busyLinks || []).map((l: { tray_id: string }) => l.tray_id);

    const { data, error } = await supabase.from('trays').select('*').order('name');
    if (error) throw error;

    return (data || []).map((t: Tray) => {
      const isBusy = busyTrayIds.includes(t.id);
      const isNotAvailable = t.status !== 'Disponible';
      let reason: string | null = null;
      if (isBusy) reason = 'Ocupada este día';
      else if (isNotAvailable) reason = t.status;
      return { ...t, busy: isBusy || isNotAvailable, unavailable_reason: reason };
    });
  },

  async getMaintenanceLogs(trayId: string): Promise<MaintenanceLog[]> {
    const { data, error } = await supabase
      .from('maintenance_logs')
      .select('*')
      .eq('tray_id', trayId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async logMaintenance(
    trayId: string,
    action: string,
    notes: string,
    performedBy: string
  ): Promise<void> {
    const { error } = await supabase
      .from('maintenance_logs')
      .insert({ tray_id: trayId, action, notes, performed_by: performedBy });
    if (error) throw error;
  },
};
