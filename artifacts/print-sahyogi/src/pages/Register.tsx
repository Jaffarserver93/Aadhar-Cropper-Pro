import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { Printer, Eye, EyeOff, Loader2, CheckCircle, MailCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export default function Register() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<'confirmed' | 'pending_email' | null>(null);
  const [loading, setLoading] = useState(false);

  if (user) {
    navigate('/');
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (code.trim().length < 4) {
      setError('Please enter a valid invite code.');
      return;
    }

    setLoading(true);
    const trimmedCode = code.trim().toUpperCase();

    // Step 1: Validate code
    const { data: codeRow, error: codeError } = await supabase
      .from('registration_codes')
      .select('id, is_used')
      .eq('code', trimmedCode)
      .eq('is_used', false)
      .single();

    if (codeError || !codeRow) {
      setError('Invalid or already used invite code. Please check and try again.');
      setLoading(false);
      return;
    }

    // Step 2: Mark code as used BEFORE creating account (prevents race condition / reuse)
    const { error: markError } = await supabase
      .from('registration_codes')
      .update({ is_used: true, used_at: new Date().toISOString() })
      .eq('id', codeRow.id)
      .eq('is_used', false); // double-check it's still unused at update time

    if (markError) {
      setError('This invite code was just used by someone else. Please get a new code.');
      setLoading(false);
      return;
    }

    // Step 3: Create user account
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (signUpError || !signUpData.user) {
      // Rollback: unmark the code so it can be used again
      await supabase
        .from('registration_codes')
        .update({ is_used: false, used_at: null })
        .eq('id', codeRow.id);

      setError(signUpError?.message ?? 'Registration failed. Please try again.');
      setLoading(false);
      return;
    }

    // Step 4: Save user ID on the code row
    await supabase
      .from('registration_codes')
      .update({ used_by: signUpData.user.id })
      .eq('id', codeRow.id);

    setLoading(false);

    // If Supabase email confirmation is ON, session will be null
    if (!signUpData.session) {
      setSuccess('pending_email');
    } else {
      setSuccess('confirmed');
    }
  };

  if (success === 'confirmed') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 text-center">
          <CheckCircle className="h-14 w-14 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Account Created!</h2>
          <p className="text-gray-500 text-sm mb-6">
            Your account has been created. You can now sign in.
          </p>
          <a
            href="/login"
            className="inline-block bg-primary text-white px-6 py-2.5 rounded-lg font-semibold text-sm hover:bg-primary/90 transition"
          >
            Go to Login
          </a>
        </div>
      </div>
    );
  }

  if (success === 'pending_email') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 text-center">
          <MailCheck className="h-14 w-14 text-blue-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Check Your Email</h2>
          <p className="text-gray-500 text-sm mb-3">
            A confirmation link has been sent to <strong>{email}</strong>.
          </p>
          <p className="text-gray-400 text-xs mb-6">
            Click the link in the email to activate your account, then come back to sign in.
          </p>
          <a
            href="/login"
            className="inline-block bg-primary text-white px-6 py-2.5 rounded-lg font-semibold text-sm hover:bg-primary/90 transition"
          >
            Go to Login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="bg-primary/10 p-3 rounded-full mb-3">
              <Printer className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Create Account</h1>
            <p className="text-gray-500 text-sm mt-1">You need an invite code to register</p>
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Invite Code
              </label>
              <input
                type="text"
                required
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition uppercase"
                placeholder="XXXXXXXX"
                maxLength={16}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 pr-10 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
                  placeholder="At least 6 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Confirm Password
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
                placeholder="Re-enter password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-white py-2.5 rounded-lg font-semibold text-sm hover:bg-primary/90 transition disabled:opacity-60 flex items-center justify-center gap-2 mt-2"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? 'Creating account…' : 'Create Account'}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            Already have an account?{' '}
            <a href="/login" className="text-primary font-medium hover:underline">
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
