import { supabase } from '../lib/supabase';
import { getImpersonatedOrgId } from '../utils/impersonation';
import type { Surgeon, UserProfile } from '../types/domain';

// SECURITY F-09: allowlist the fields a client may write to prevent mass
// assignment of unintended columns (e.g. id, created_at).
const ALLOWED_FIELDS: Array<keyof Surgeon> = [
  'full_name', 'specialty', 'email', 'phone', 'user_id', 'preferences',
];

function pickAllowed(surgeon: Partial<Surgeon>): Partial<Surgeon> {
  const clean: Partial<Surgeon> = {};
  ALLOWED_FIELDS.forEach(field => {
    if (surgeon[field] !== undefined) {
      (clean as Record<string, unknown>)[field] = surgeon[field];
    }
  });
  return clean;
}

export function withTimeout<T>(promise: PromiseLike<T>, ms = 8000, label = 'Query'): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

export const surgeonService = {
  async getAll(): Promise<Surgeon[]> {
    const orgOverride = getImpersonatedOrgId();
    let baseQuery = supabase.from('surgeons').select('*').order('full_name');
    if (orgOverride) baseQuery = baseQuery.eq('org_id', orgOverride);
    const { data, error } = await withTimeout(baseQuery, 8000, 'surgeonService.getAll');
    if (error) throw error;
    return data;
  },

  async create(surgeon: Omit<Surgeon, 'id' | 'created_at'>): Promise<Surgeon> {
    const { data, error } = await supabase
      .from('surgeons').insert(pickAllowed(surgeon)).select().single();
    if (error) throw error;
    return data;
  },

  async update(id: string, surgeon: Partial<Surgeon>): Promise<Surgeon> {
    const { data, error } = await supabase
      .from('surgeons').update(pickAllowed(surgeon)).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from('surgeons').delete().eq('id', id);
    if (error) throw error;
  },

  async getUserByEmail(email: string): Promise<Pick<UserProfile, 'id'> | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async createPortalUser(userData: {
    email: string;
    full_name: string;
  }): Promise<{ userId: string; tempPassword: string }> {
    // SECURITY F-03: use a cryptographically secure RNG for temp passwords.
    // Math.random() is predictable and unsuitable for credentials.
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const randomBytes = new Uint32Array(10);
    crypto.getRandomValues(randomBytes);
    const tempPassword = Array.from(
      randomBytes,
      (n) => chars[n % chars.length]
    ).join('');

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: userData.email,
      password: tempPassword,
      options: { data: { full_name: userData.full_name } },
    });

    if (signUpError) throw signUpError;

    const userId = signUpData.user?.id;
    if (!userId) throw new Error('No se pudo crear el usuario de autenticación.');

    await new Promise<void>(r => setTimeout(r, 1500));

    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: userId,
        full_name: userData.full_name,
        email: userData.email,
        role: 'Cirujano',
        is_active: true,
        must_change_password: true,
      }, { onConflict: 'id' });

    if (profileError) console.warn('Profile update warning:', profileError);

    return { userId, tempPassword };
  },
};
