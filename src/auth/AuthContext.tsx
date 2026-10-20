import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { AppUser, Hotel, Role } from '@/types';

interface AuthState {
  user: AppUser | null;
  hotels: Hotel[]; // hotels the user is allowed to see
  allHotels: Hotel[]; // every hotel (admin only useful)
  loading: boolean;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  changePassword: (newPassword: string) => Promise<{ ok: boolean; error?: string }>;
  refreshHotels: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

const STORAGE_KEY = 'rt_session';
const SESSION_MS = 60 * 60 * 1000; // 60 minutes

interface StoredSession {
  userId: string;
  expiry: number; // epoch ms
}

function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.userId || !parsed?.expiry) return null;
    if (Date.now() > parsed.expiry) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function writeSession(userId: string) {
  const session: StoredSession = { userId, expiry: Date.now() + SESSION_MS };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [allHotels, setAllHotels] = useState<Hotel[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHotels = useCallback(async (): Promise<Hotel[]> => {
    const { data, error } = await supabase.from('hotels').select('*').order('name');
    if (error) return [];
    return (data as Hotel[]) || [];
  }, []);

  const refreshHotels = useCallback(async () => {
    const hs = await loadHotels();
    setAllHotels(hs);
  }, [loadHotels]);

  // On mount: restore session if still within 60-minute window
  useEffect(() => {
    (async () => {
      const session = readSession();
      if (session) {
        const { data } = await supabase
          .from('app_users')
          .select('*')
          .eq('id', session.userId)
          .maybeSingle();
        if (data) {
          setUser(data as AppUser);
          // bump expiry on active restore
          writeSession(data.id);
          await refreshHotels();
        } else {
          clearSession();
        }
      }
      setLoading(false);
    })();
  }, []);

  // Auto-logout timer: check every 30s, and a hard timeout at expiry
  useEffect(() => {
    if (!user) return;
    const session = readSession();
    if (!session) return;
    const remaining = session.expiry - Date.now();
    const tick = setInterval(() => {
      const s = readSession();
      if (!s) {
        setUser(null);
        clearInterval(tick);
      }
    }, 30000);
    const hard = setTimeout(() => {
      clearSession();
      setUser(null);
    }, Math.max(remaining, 0));
    return () => {
      clearInterval(tick);
      clearTimeout(hard);
    };
  }, [user]);

  const login = useCallback(
    async (username: string, password: string) => {
      const { data, error } = await supabase
        .from('app_users')
        .select('*')
        .eq('username', username.trim())
        .maybeSingle();
      if (error) return { ok: false, error: error.message };
      if (!data) return { ok: false, error: 'Tài khoản không tồn tại' };
      if (data.password !== password) return { ok: false, error: 'Mật khẩu không đúng' };
      setUser(data as AppUser);
      writeSession(data.id);
      await refreshHotels();
      return { ok: true };
    },
    [refreshHotels],
  );

  const logout = useCallback(() => {
    setUser(null);
    clearSession();
  }, []);

  const changePassword = useCallback(
    async (newPassword: string) => {
      if (!user) return { ok: false, error: 'Chưa đăng nhập' };
      if (!newPassword || newPassword.length < 1) return { ok: false, error: 'Mật khẩu không hợp lệ' };
      const { error } = await supabase
        .from('app_users')
        .update({ password: newPassword })
        .eq('id', user.id);
      if (error) return { ok: false, error: error.message };
      setUser({ ...user, password: newPassword });
      return { ok: true };
    },
    [user],
  );

  const hotels = useMemo<Hotel[]>(() => {
    if (!user) return [];
    if (user.role === 'admin' || user.allowed_hotel_ids?.includes('*')) return allHotels;
    const allowed = new Set(user.allowed_hotel_ids || []);
    return allHotels.filter((h) => allowed.has(h.id));
  }, [user, allHotels]);

  const value: AuthState = useMemo(
    () => ({
      user,
      hotels,
      allHotels,
      loading,
      login,
      logout,
      changePassword,
      refreshHotels,
    }),
    [user, hotels, allHotels, loading, login, logout, changePassword, refreshHotels],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function isAdmin(u: AppUser | null): boolean {
  return u?.role === 'admin';
}

export function canAccessPuReport(u: AppUser | null): boolean {
  return !!u && (u.role === 'admin' || u.can_access_pu_report === true);
}

export function canSeeAllHotels(u: AppUser | null): boolean {
  return !!u && (u.role === 'admin' || (u.allowed_hotel_ids || []).includes('*'));
}

export function roleLabel(r: Role): string {
  return r === 'admin' ? 'Admin' : 'User';
}
