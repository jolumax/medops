-- =================================================================================
-- MIGRACIÓN 0001 — MULTI-TENANCY: SCHEMA + BACKFILL
-- MedOps · convierte la base single-tenant en multi-tenant (DB compartida + RLS)
-- =================================================================================
-- Ejecutar en el SQL Editor de Supabase ANTES de 0002_multitenancy_rls.sql.
-- Idempotente: usa IF NOT EXISTS / IF EXISTS donde es posible.
-- =================================================================================

-- ---------------------------------------------------------------------------------
-- 1. TABLA organizations (primero, sin dependencias)
-- ---------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text UNIQUE,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------
-- 2. profiles: org_id + is_platform_admin
--    Deben existir ANTES de crear las funciones (PostgreSQL valida SQL functions).
-- ---------------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------------
-- 3. FUNCIONES AUXILIARES
--    Ahora profiles.org_id ya existe → la función compila sin error.
-- ---------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_org_id()
RETURNS uuid AS $$
  SELECT org_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean AS $$
  SELECT coalesce(profiles.is_platform_admin, false)
  FROM public.profiles WHERE profiles.id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- ---------------------------------------------------------------------------------
-- 4. org_id en las 12 tablas de datos (nullable primero, para backfill)
-- ---------------------------------------------------------------------------------

ALTER TABLE public.hospitals           ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.surgeons            ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.trays               ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.surgeries           ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.surgery_trays       ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.maintenance_logs    ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.implants            ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.implant_lots        ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.ars                 ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.surgery_consumption ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.notifications       ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.audit_logs          ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);

-- organization_settings: se rekey-a por org_id (deja de ser singleton id=1).
ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);

-- ---------------------------------------------------------------------------------
-- 5. BACKFILL: crear la organización para la data existente y asignarla a todo
-- ---------------------------------------------------------------------------------

DO $$
DECLARE
  v_org  uuid;
  v_name text;
BEGIN
  -- Nombre de la org a partir de la configuración existente (si la hay).
  SELECT NULLIF(trim(company_name), '')
    INTO v_name
    FROM public.organization_settings
    WHERE id = 1
    LIMIT 1;

  IF v_name IS NULL THEN
    v_name := 'Organización Principal';
  END IF;

  INSERT INTO public.organizations (name)
    VALUES (v_name)
    RETURNING id INTO v_org;

  -- Backfill de las 12 tablas de datos.
  UPDATE public.hospitals           SET org_id = v_org WHERE org_id IS NULL;
  UPDATE public.surgeons            SET org_id = v_org WHERE org_id IS NULL;
  UPDATE public.trays               SET org_id = v_org WHERE org_id IS NULL;
  UPDATE public.surgeries           SET org_id = v_org WHERE org_id IS NULL;
  UPDATE public.surgery_trays       SET org_id = v_org WHERE org_id IS NULL;
  UPDATE public.maintenance_logs    SET org_id = v_org WHERE org_id IS NULL;
  UPDATE public.implants            SET org_id = v_org WHERE org_id IS NULL;
  UPDATE public.implant_lots        SET org_id = v_org WHERE org_id IS NULL;
  UPDATE public.ars                 SET org_id = v_org WHERE org_id IS NULL;
  UPDATE public.surgery_consumption SET org_id = v_org WHERE org_id IS NULL;
  UPDATE public.notifications       SET org_id = v_org WHERE org_id IS NULL;
  UPDATE public.audit_logs          SET org_id = v_org WHERE org_id IS NULL;

  -- organization_settings + perfiles existentes.
  UPDATE public.organization_settings SET org_id = v_org WHERE org_id IS NULL;
  UPDATE public.profiles              SET org_id = v_org WHERE org_id IS NULL;

  RAISE NOTICE 'Backfill completado. Organización creada: % (%).', v_name, v_org;
END $$;

-- ---------------------------------------------------------------------------------
-- 6. ENDURECER: NOT NULL + DEFAULT get_my_org_id()
--    El DEFAULT hace que cada INSERT reciba el org_id del usuario automáticamente;
--    el cliente no necesita enviarlo y no puede falsificarlo.
-- ---------------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'hospitals','surgeons','trays','surgeries','surgery_trays','maintenance_logs',
    'implants','implant_lots','ars','surgery_consumption','notifications','audit_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN org_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN org_id SET DEFAULT public.get_my_org_id()', t);
  END LOOP;
END $$;

-- organization_settings: org_id obligatorio, único y con DEFAULT get_my_org_id()
-- para que el upsert de settings desde el frontend no necesite enviarlo.
ALTER TABLE public.organization_settings ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.organization_settings ALTER COLUMN org_id SET DEFAULT public.get_my_org_id();
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organization_settings_org_id_key'
  ) THEN
    ALTER TABLE public.organization_settings
      ADD CONSTRAINT organization_settings_org_id_key UNIQUE (org_id);
  END IF;
END $$;

-- profiles.org_id queda NULLABLE a propósito: un platform admin puede no
-- pertenecer a ninguna organización. Pero recibe DEFAULT get_my_org_id():
-- cuando un Administrador crea un usuario, el nuevo perfil hereda la org del
-- creador automáticamente (el frontend inserta el perfil con el token del
-- admin). La política RLS Profiles_Admin_All además lo verifica.
ALTER TABLE public.profiles ALTER COLUMN org_id SET DEFAULT public.get_my_org_id();

-- ---------------------------------------------------------------------------------
-- 7. ÍNDICES sobre org_id (el filtro RLS se evalúa en cada query)
-- ---------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_hospitals_org_id           ON public.hospitals(org_id);
CREATE INDEX IF NOT EXISTS idx_surgeons_org_id            ON public.surgeons(org_id);
CREATE INDEX IF NOT EXISTS idx_trays_org_id               ON public.trays(org_id);
CREATE INDEX IF NOT EXISTS idx_surgeries_org_id           ON public.surgeries(org_id);
CREATE INDEX IF NOT EXISTS idx_surgery_trays_org_id       ON public.surgery_trays(org_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_logs_org_id    ON public.maintenance_logs(org_id);
CREATE INDEX IF NOT EXISTS idx_implants_org_id            ON public.implants(org_id);
CREATE INDEX IF NOT EXISTS idx_implant_lots_org_id        ON public.implant_lots(org_id);
CREATE INDEX IF NOT EXISTS idx_ars_org_id                 ON public.ars(org_id);
CREATE INDEX IF NOT EXISTS idx_surgery_consumption_org_id ON public.surgery_consumption(org_id);
CREATE INDEX IF NOT EXISTS idx_notifications_org_id       ON public.notifications(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_id          ON public.audit_logs(org_id);
CREATE INDEX IF NOT EXISTS idx_profiles_org_id            ON public.profiles(org_id);

-- =================================================================================
-- FIN 0001 — continuar con 0002_multitenancy_rls.sql
-- =================================================================================
