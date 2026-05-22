import { supabase } from '../lib/supabase';
import { auditService } from './auditService';
import { getLocalDateString } from '../utils/dateUtils';
import { getImpersonatedOrgId } from '../utils/impersonation';
import type { Implant, ImplantLot, SurgeryConsumption } from '../types/domain';

interface ConsumptionInput {
  surgery_id: string;
  implant_lot_id: string;
  quantity_used: number;
  notes?: string;
  auth_number?: string;
}

export const implantService = {
  async getAll(): Promise<Implant[]> {
    const orgOverride = getImpersonatedOrgId();
    let query = supabase
      .from('implants')
      .select(`*, implant_lots (id, lot_number, expiration_date, current_quantity)`)
      .order('name');
    if (orgOverride) query = query.eq('org_id', orgOverride);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async create(implant: Omit<Implant, 'id' | 'created_at' | 'implant_lots'>): Promise<Implant> {
    const { data, error } = await supabase
      .from('implants').insert(implant).select().single();
    if (error) throw error;
    await auditService.log('IMPLANT_CREATE', 'implants', data.id, implant as Record<string, unknown>);
    return data;
  },

  async update(id: string, updates: Partial<Implant>): Promise<Implant> {
    const { data, error } = await supabase
      .from('implants').update(updates).eq('id', id).select().single();
    if (error) throw error;
    await auditService.log('IMPLANT_UPDATE', 'implants', id, updates as Record<string, unknown>);
    return data;
  },

  async delete(id: string): Promise<true> {
    const { error } = await supabase.from('implants').delete().eq('id', id);
    if (error) throw error;
    await auditService.log('IMPLANT_DELETE', 'implants', id, { note: 'Producto eliminado' });
    return true;
  },

  async addLot(lot: Omit<ImplantLot, 'id' | 'created_at'>): Promise<ImplantLot> {
    const { data, error } = await supabase
      .from('implant_lots').insert(lot).select().single();
    if (error) throw error;
    await auditService.log('LOT_ADD', 'implant_lots', data.id, lot as Record<string, unknown>);
    return data;
  },

  async updateLot(id: string, updates: Partial<ImplantLot>): Promise<ImplantLot> {
    const { data, error } = await supabase
      .from('implant_lots').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async reportConsumption(consumptionData: ConsumptionInput): Promise<true> {
    const { surgery_id, implant_lot_id, quantity_used, notes, auth_number } = consumptionData;

    // SECURITY F-08: the previous read-check-write was not atomic, so two
    // concurrent calls could both pass the stock check and over-consume the
    // lot. Decrement first with a compare-and-swap update guarded by the
    // quantity we read; if another transaction changed the stock in between,
    // this update matches zero rows and we abort instead of over-consuming.
    const { data: lot, error: lotError } = await supabase
      .from('implant_lots')
      .select('current_quantity')
      .eq('id', implant_lot_id)
      .single();
    if (lotError) throw lotError;
    if (lot.current_quantity < quantity_used) {
      throw new Error('Stock insuficiente en el lote seleccionado');
    }

    const { data: updatedLot, error: updateError } = await supabase
      .from('implant_lots')
      .update({ current_quantity: lot.current_quantity - quantity_used })
      .eq('id', implant_lot_id)
      .eq('current_quantity', lot.current_quantity)
      .select('id');
    if (updateError) throw updateError;
    if (!updatedLot || updatedLot.length === 0) {
      throw new Error('El stock del lote cambió durante la operación. Reintente.');
    }

    const { error: consumptionError } = await supabase
      .from('surgery_consumption')
      .insert({ surgery_id, implant_lot_id, quantity_used, notes, auth_number });
    if (consumptionError) {
      // Compensating action: the consumption record failed, so give the
      // decremented stock back (best effort).
      const { data: fresh } = await supabase
        .from('implant_lots')
        .select('current_quantity')
        .eq('id', implant_lot_id)
        .single();
      if (fresh) {
        await supabase
          .from('implant_lots')
          .update({ current_quantity: fresh.current_quantity + quantity_used })
          .eq('id', implant_lot_id);
      }
      throw consumptionError;
    }

    await auditService.log('CONSUMPTION_REPORT', 'surgery_consumption', surgery_id, consumptionData as unknown as Record<string, unknown>);
    return true;
  },

  async getConsumptionBySurgery(surgeryId: string): Promise<SurgeryConsumption[]> {
    const { data, error } = await supabase
      .from('surgery_consumption')
      .select(`*, implant_lots (lot_number, implants (name, sku, unit_cost))`)
      .eq('surgery_id', surgeryId);
    if (error) throw error;
    return data;
  },

  async bulkCreateImplants(implants: Array<Omit<Implant, 'id' | 'created_at' | 'implant_lots'>>): Promise<Implant[]> {
    // SECURITY F-15: cap batch size so a client cannot push an
    // unbounded payload that loads the database.
    if (implants.length === 0) return [];
    if (implants.length > 500) {
      throw new Error('Máximo 500 implantes por lote');
    }
    const { data, error } = await supabase
      .from('implants').insert(implants).select();
    if (error) throw error;
    return data;
  },

  async getConsumptionReport(startDate?: string, endDate?: string): Promise<SurgeryConsumption[]> {
    let query = supabase
      .from('surgery_consumption')
      .select(`
        *,
        implant_lots (id, lot_number, implants (id, name, sku, category, unit_cost, selling_price)),
        surgeries!inner (id, patient_name, surgery_date, status, surgeon_id, hospital_id,
          surgeon: surgeons (full_name), hospital: hospitals (name))
      `)
      .eq('surgeries.status', 'Completada')
      .order('used_at', { ascending: false });

    if (startDate) query = query.gte('used_at', startDate);
    if (endDate) query = query.lte('used_at', endDate);

    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async getExpiringLots(): Promise<ImplantLot[]> {
    const { data, error } = await supabase
      .from('implant_lots')
      .select(`*, implants (name, sku)`)
      .lte('expiration_date', getLocalDateString(new Date(Date.now() + 90 * 86400000)))
      .gt('current_quantity', 0)
      .order('expiration_date');
    if (error) throw error;
    return data;
  },

  async getLowStockImplants(): Promise<Implant[]> {
    const { data, error } = await supabase
      .from('implants')
      .select(`*, implant_lots (current_quantity)`);
    if (error) throw error;

    return data.filter((imp: Implant) => {
      const total = (imp.implant_lots || []).reduce(
        (acc: number, lot: ImplantLot) => acc + lot.current_quantity, 0
      );
      return total <= (imp.min_stock || 0);
    });
  },

  async getAllLotsDetailed(): Promise<ImplantLot[]> {
    const { data, error } = await supabase
      .from('implant_lots')
      .select(`*, implants (id, name, sku, category, unit_cost, selling_price)`);
    if (error) throw error;
    return data;
  },
};
