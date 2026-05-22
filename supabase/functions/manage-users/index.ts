import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

    // 1. Validar Autenticación (JWT)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('No authorization header')

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    })

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
    if (authError || !user) throw new Error('Unauthorized: Invalid token')

    // 2. Validar Autorización (Roles)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)
    
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) throw new Error('Unauthorized: Profile not found')
    if (!['Superadmin', 'Administrador'].includes(profile.role)) {
      throw new Error('Forbidden: Insufficient permissions')
    }

    // 3. Procesar Acción (ya validado)
    const { action, userData, userId } = await req.json()

    // 1. CREAR USUARIO
    if (action === 'create') {
      const { email, password, full_name, role } = userData
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name, role }
      })
      if (error) throw error
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 2. ACTUALIZAR USUARIO
    if (action === 'update') {
      const { email, password, full_name, role, is_active } = userData
      const updates: any = {
        email,
        user_metadata: { full_name, role }
      }
      if (password) updates.password = password

      const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, updates)
      if (error) throw error
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 3. ELIMINAR USUARIO
    if (action === 'delete') {
      // Intentar eliminar de auth.users; ignorar si el usuario no existe allí
      // (puede ser un perfil creado manualmente sin cuenta auth).
      const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(userId)
      if (authDeleteError && !authDeleteError.message.toLowerCase().includes('not found')) {
        throw authDeleteError
      }
      // Eliminar siempre el perfil de la tabla profiles.
      const { error: profileDeleteError } = await supabaseAdmin
        .from('profiles')
        .delete()
        .eq('id', userId)
      if (profileDeleteError) throw profileDeleteError
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    throw new Error('Acción no válida')

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.message.includes('Unauthorized') ? 401 : error.message.includes('Forbidden') ? 403 : 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
