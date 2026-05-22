import React from 'react';
import { Sidebar } from './Sidebar';
import { ImpersonationBanner } from '../ImpersonationBanner';
import { Bell, Search, LayoutDashboard, CalendarDays, Stethoscope, Package, Users, BarChart3, Settings, Wrench } from 'lucide-react';
import { surgeryService } from '../../services/surgeryService';
import { implantService } from '../../services/implantService';
import { cn } from '../../utils/cn';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { NotificationPanel } from './NotificationPanel';
import { notificationService } from '../../services/notificationService';
import type { UserProfile } from '../../types/domain';

interface NavItem {
  icon: React.ElementType;
  path: string;
  label: string;
  roles: string[];
}

const MobileNav: React.FC<{ role?: string }> = ({ role }) => {
  const { pathname } = useLocation();
  const navItems: NavItem[] = [
    { icon: LayoutDashboard, path: '/',              label: role === 'Cirujano' ? 'Portal' : 'Inicio', roles: ['Superadmin', 'Administrador', 'Técnico', 'Cirujano', 'Editor', 'Lector'] },
    { icon: CalendarDays,    path: '/calendario',    label: 'Agenda',    roles: ['Superadmin', 'Administrador', 'Técnico', 'Cirujano', 'Editor', 'Lector'] },
    { icon: Stethoscope,     path: '/cirugias',      label: 'Cirugías',  roles: ['Superadmin', 'Administrador', 'Técnico', 'Cirujano', 'Editor', 'Lector'] },
    { icon: Package,         path: '/bandejas',      label: 'Sets',      roles: ['Superadmin', 'Administrador', 'Técnico', 'Editor'] },
    { icon: Wrench,          path: '/mantenimiento', label: 'Mant.',     roles: ['Superadmin', 'Administrador', 'Técnico', 'Editor'] },
    { icon: Users,           path: '/directorio',    label: 'Dir.',      roles: ['Superadmin', 'Administrador', 'Técnico', 'Cirujano', 'Editor', 'Lector'] },
    { icon: BarChart3,       path: '/reportes',      label: 'Reportes',  roles: ['Superadmin', 'Administrador'] },
    { icon: Settings,        path: '/configuracion', label: 'Ajustes',   roles: ['Superadmin', 'Administrador'] },
  ];

  const filtered = navItems.filter(item =>
    !role ? item.roles.some(r => r !== 'Cirujano') : item.roles.includes(role)
  );

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-2 flex justify-around items-center z-50 pb-safe">
      {filtered.map((item) => {
        const active = pathname === item.path;
        return (
          <Link
            key={`${item.path}-${item.label}`}
            to={item.path}
            className={cn('flex flex-col items-center gap-1 p-2 rounded-xl transition-all', active ? 'text-primary bg-primary/5' : 'text-slate-400')}
          >
            <item.icon size={20} strokeWidth={active ? 2.5 : 2} />
            <span className="text-[10px] font-bold uppercase tracking-tighter">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
};

interface LayoutProps {
  children: React.ReactNode;
  userProfile: Partial<UserProfile> | null;
}

export const Layout: React.FC<LayoutProps> = ({ children, userProfile }) => {
  const navigate = useNavigate();
  const [globalSearch, setGlobalSearch] = React.useState('');
  const [time, setTime] = React.useState(new Date());
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [showNotifs, setShowNotifs] = React.useState(false);
  const [lowStockCount, setLowStockCount] = React.useState(0);

  React.useEffect(() => {
    if (!userProfile?.id) return;
    notificationService.getMyNotifications().then(data => {
      setUnreadCount(data.filter(n => !n.is_read).length);
    });
    const subscription = notificationService.subscribeToNotifications(userProfile.id, () => {
      setUnreadCount(prev => prev + 1);
    });
    return () => { if (subscription) supabase.removeChannel(subscription); };
  }, [userProfile?.id]);

  React.useEffect(() => {
    Promise.all([implantService.getLowStockImplants(), implantService.getExpiringLots()])
      .then(([lowStock, expiring]) => {
        setLowStockCount((lowStock?.length || 0) + (expiring?.length || 0));
      })
      .catch(err => console.error('Layout: Error fetching inventory alerts:', err));
  }, []);

  React.useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && globalSearch.trim()) {
      navigate(`/cirugias?q=${encodeURIComponent(globalSearch.trim())}`);
      setGlobalSearch('');
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans selection:bg-primary/10 selection:text-primary">
      <Sidebar className="hidden lg:flex" role={userProfile?.role} profile={userProfile} lowStockCount={lowStockCount} />

      <main className="flex-1 lg:ml-64 min-h-screen flex flex-col pb-16 lg:pb-0">
        <header className="h-16 bg-white border-b border-slate-200 px-4 lg:px-8 flex items-center justify-between sticky top-0 z-40">
          <div className="flex-1 max-w-md">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors" size={18} />
              <input
                type="text"
                placeholder="Buscar..."
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                onKeyDown={handleSearch}
                className="w-full pl-10 pr-4 py-2 bg-slate-100 border-transparent rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 lg:gap-4 ml-2">
            <div className="relative">
              <button
                onClick={() => setShowNotifs(!showNotifs)}
                className={cn('relative p-2 text-slate-500 hover:bg-slate-50 rounded-full transition-colors', showNotifs && 'bg-slate-100 text-primary')}
              >
                <Bell size={20} />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-danger text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-white animate-pulse">
                    {unreadCount}
                  </span>
                )}
              </button>
              {showNotifs && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowNotifs(false)} />
                  <NotificationPanel
                    userId={userProfile?.id}
                    isOpen={showNotifs}
                    onClose={() => setShowNotifs(false)}
                    onUpdate={() => {
                      notificationService.getMyNotifications().then(data => {
                        setUnreadCount(data.filter(n => !n.is_read).length);
                      });
                    }}
                  />
                </>
              )}
            </div>

            <div className="h-8 w-px bg-slate-200 mx-1 hidden sm:block" />
            <div className="hidden sm:flex items-center gap-3">
              <div className="text-right">
                <p className="text-[10px] text-slate-500 font-medium capitalize leading-tight">
                  {time.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                </p>
                <p className="text-xs font-bold text-slate-900 uppercase leading-tight">
                  {time.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          </div>
        </header>

        <ImpersonationBanner />
        <div className="p-4 lg:p-8 flex-1 animate-in fade-in slide-in-from-bottom-4 duration-700 overflow-x-hidden">
          {children}
        </div>

        <MobileNav role={userProfile?.role} />
      </main>
    </div>
  );
};
