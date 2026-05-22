import React, { useState, useEffect } from 'react';
import { ToastProvider } from './components/ui/Toast';
import { ImpersonationProvider } from './contexts/ImpersonationContext';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { Layout } from './components/layout/Layout';
import { Dashboard } from './pages/Dashboard';
import { Calendario } from './pages/Calendario';
import { Cirugias } from './pages/Cirugias';
import { Bandejas } from './pages/Bandejas';
import { Mantenimiento } from './pages/Mantenimiento';
import { Directorio } from './pages/Directorio';
import { Reportes } from './pages/Reportes';
import { Configuracion } from './pages/Configuracion';
import { Login } from './pages/Login';
import { MisSolicitudes } from './pages/MisSolicitudes';
import { InventarioQuirurgico } from './pages/InventarioQuirurgico';
import { ReporteReposicion } from './pages/ReporteReposicion';
import { ReporteLotes } from './pages/ReporteLotes';
import { Organizaciones } from './pages/Organizaciones';
import { ForcePasswordChange } from './components/auth/ForcePasswordChange';
import type { Session } from '@supabase/supabase-js';
import type { UserProfile } from './types/domain';

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  const loadProfile = async (sessionObj: Session | null): Promise<UserProfile | null> => {
    if (!sessionObj?.user) return null;
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/profiles?id=eq.${sessionObj.user.id}&select=*&limit=1`;
      const res = await fetch(url, {
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${sessionObj.access_token}`,
          'Accept': 'application/json',
        },
      });
      const data = await res.json();

      if (Array.isArray(data) && data.length > 0) {
        const profile = data[0] as UserProfile;
        if (profile.role === 'Cirujano') {
          try {
            const sUrl = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/surgeons?user_id=eq.${sessionObj.user.id}&select=id&limit=1`;
            const sRes = await fetch(sUrl, {
              headers: {
                'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${sessionObj.access_token}`,
                'Accept': 'application/json',
              },
            });
            if (sRes.ok) {
              const sData = await sRes.json();
              if (sData.length > 0) (profile as UserProfile & { surgeon_id?: string }).surgeon_id = sData[0].id;
            }
          } catch (sErr) { console.warn('App: Could not fetch surgeon_id:', sErr); }
        }
        return profile;
      }

      console.warn('App: Profile not found in DB for user:', sessionObj.user.id);
      return {
        id: sessionObj.user.id,
        email: sessionObj.user.email || '',
        full_name: (sessionObj.user.user_metadata?.full_name as string) || sessionObj.user.email || '',
        role: 'Lector',
        is_active: true,
        must_change_password: false,
        created_at: '',
      };
    } catch (err) {
      console.error('App: Error fetching profile:', err);
      return {
        id: sessionObj.user.id,
        email: sessionObj.user.email || '',
        full_name: sessionObj.user.email || '',
        role: 'Lector',
        is_active: true,
        must_change_password: false,
        created_at: '',
      };
    }
  };

  useEffect(() => {
    let settled = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, sessionObj) => {
      if (settled) {
        setSession(sessionObj);
        if (sessionObj?.user) {
          const profile = await loadProfile(sessionObj);
          setUserProfile(profile);
        } else {
          setUserProfile(null);
        }
        return;
      }

      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
        settled = true;
        setSession(sessionObj);
        if (sessionObj?.user) {
          const profile = await loadProfile(sessionObj);
          setUserProfile(profile);
        }
        setLoading(false);
      } else if (event === 'SIGNED_OUT') {
        settled = true;
        setSession(null);
        setUserProfile(null);
        setLoading(false);
      }
    });

    const safetyTimer = setTimeout(() => {
      if (!settled) { settled = true; setLoading(false); }
    }, 8000);

    return () => { subscription.unsubscribe(); clearTimeout(safetyTimer); };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        <p className="font-semibold text-slate-400 text-sm">Cargando MedOps...</p>
      </div>
    );
  }

  const isSurgeon = userProfile?.role === 'Cirujano';

  return (
    <ImpersonationProvider>
    <ToastProvider>
      <Router>
        <Routes>
          <Route path="/login" element={!session ? <Login /> : <Navigate to="/" />} />
          <Route path="/*" element={
            session ? (
              <>
                {userProfile?.must_change_password && (
                  <ForcePasswordChange
                    user={userProfile}
                    onPasswordChanged={async () => {
                      const profile = await loadProfile(session);
                      setUserProfile(profile);
                    }}
                  />
                )}
                <Layout userProfile={userProfile}>
                  <Routes>
                    <Route path="/" element={isSurgeon ? <Navigate to="/mis-solicitudes" replace /> : <Dashboard />} />
                    <Route path="/calendario" element={<Calendario userProfile={userProfile} />} />
                    <Route path="/cirugias" element={<Cirugias userProfile={userProfile} />} />
                    <Route path="/bandejas" element={!isSurgeon ? <Bandejas /> : <Navigate to="/mis-solicitudes" replace />} />
                    <Route path="/mantenimiento" element={!isSurgeon ? <Mantenimiento /> : <Navigate to="/mis-solicitudes" replace />} />
                    <Route path="/directorio" element={!isSurgeon ? <Directorio /> : <Navigate to="/mis-solicitudes" replace />} />
                    <Route path="/reportes" element={!isSurgeon ? <Reportes /> : <Navigate to="/mis-solicitudes" replace />} />
                    <Route path="/configuracion" element={<Configuracion userProfile={userProfile} />} />
                    <Route path="/organizaciones" element={userProfile?.is_platform_admin ? <Organizaciones /> : <Navigate to="/" replace />} />
                    <Route path="/inventario" element={!isSurgeon ? <InventarioQuirurgico /> : <Navigate to="/mis-solicitudes" replace />} />
                    <Route path="/reporte-reposicion" element={!isSurgeon ? <ReporteReposicion /> : <Navigate to="/mis-solicitudes" replace />} />
                    <Route path="/reporte-lotes" element={!isSurgeon ? <ReporteLotes /> : <Navigate to="/mis-solicitudes" replace />} />
                    <Route path="/mis-solicitudes" element={<MisSolicitudes userProfile={userProfile} />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </Layout>
              </>
            ) : (
              <Navigate to="/login" />
            )
          } />
        </Routes>
      </Router>
    </ToastProvider>
    </ImpersonationProvider>
  );
}

export default App;
