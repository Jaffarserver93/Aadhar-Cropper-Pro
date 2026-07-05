import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  type AppUser,
  getStoredUser,
  customSignIn,
  customSignOut,
} from '@/lib/auth';

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  isAdmin: boolean;
  signIn: (username: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUser(getStoredUser());
    setLoading(false);
  }, []);

  const signIn = async (username: string, password: string) => {
    const { user: u, error } = await customSignIn(username, password);
    if (u) setUser(u);
    return { error };
  };

  const signOut = () => {
    customSignOut();
    setUser(null);
  };

  const isAdmin = user?.username === 'admin';

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
