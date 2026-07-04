import React, { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import {
  Key,
  Plus,
  Copy,
  Check,
  Loader2,
  ShieldAlert,
  RefreshCw,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { supabase, type RegistrationCode } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Navbar } from '@/components/Navbar';

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export default function CodeGenerator() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [codes, setCodes] = useState<RegistrationCode[]>([]);
  const [fetching, setFetching] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState('');

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/login');
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user && isAdmin) {
      fetchCodes();
    } else if (user && !authLoading) {
      setFetching(false);
    }
  }, [user, isAdmin, authLoading]);

  const fetchCodes = async () => {
    setFetching(true);
    setFetchError('');
    const { data, error } = await supabase
      .from('registration_codes')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      setFetchError('Failed to load codes. Make sure you have admin access.');
    } else {
      setCodes(data ?? []);
    }
    setFetching(false);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    const code = generateCode();
    const { data, error } = await supabase
      .from('registration_codes')
      .insert({ code, created_by: user!.id })
      .select()
      .single();

    if (!error && data) {
      setCodes((prev) => [data, ...prev]);
    }
    setGenerating(false);
  };

  const handleCopy = (code: RegistrationCode) => {
    navigator.clipboard.writeText(code.code);
    setCopiedId(code.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="max-w-lg mx-auto mt-20 text-center px-4">
          <ShieldAlert className="h-14 w-14 text-red-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-500">
            This page is only accessible to admins. Contact the site owner to get admin access.
          </p>
        </div>
      </div>
    );
  }

  const usedCount = codes.filter((c) => c.is_used).length;
  const unusedCount = codes.filter((c) => !c.is_used).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="flex items-center gap-3 mb-2">
          <Key className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-gray-900">Code Generator</h1>
        </div>
        <p className="text-gray-500 text-sm mb-8">
          Generate single-use invite codes for new user registration.
        </p>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm text-center">
            <p className="text-3xl font-bold text-gray-900">{codes.length}</p>
            <p className="text-xs text-gray-500 mt-1">Total Codes</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm text-center">
            <p className="text-3xl font-bold text-green-600">{unusedCount}</p>
            <p className="text-xs text-gray-500 mt-1">Available</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm text-center">
            <p className="text-3xl font-bold text-gray-400">{usedCount}</p>
            <p className="text-xs text-gray-500 mt-1">Used</p>
          </div>
        </div>

        <div className="flex gap-3 mb-6">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-lg font-semibold text-sm hover:bg-primary/90 transition disabled:opacity-60"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Generate Code
          </button>
          <button
            onClick={fetchCodes}
            disabled={fetching}
            className="flex items-center gap-2 border border-gray-200 text-gray-600 px-4 py-2.5 rounded-lg font-medium text-sm hover:bg-gray-50 transition"
          >
            <RefreshCw className={`h-4 w-4 ${fetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {fetchError && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
            {fetchError}
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {fetching ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : codes.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Key className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No codes yet. Generate your first one.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Code
                  </th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {codes.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="font-mono font-semibold text-gray-900 tracking-widest">
                        {c.code}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      {c.is_used ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
                          <CheckCircle2 className="h-3 w-3" />
                          Used
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2.5 py-1 rounded-full">
                          <Clock className="h-3 w-3" />
                          Available
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-gray-400 text-xs">
                      {new Date(c.created_at).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {!c.is_used && (
                        <button
                          onClick={() => handleCopy(c)}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium transition"
                        >
                          {copiedId === c.id ? (
                            <>
                              <Check className="h-3.5 w-3.5" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" />
                              Copy
                            </>
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
