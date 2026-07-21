import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Sun, Moon } from 'lucide-react';
import { SystemTheme } from '../types';

export default function LoginView() {
  const { login } = useAuth();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState<SystemTheme>(() => 
    (localStorage.getItem('fage_theme') as SystemTheme) || 'analytics'
  );

  useEffect(() => {
    localStorage.setItem('fage_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(theme === 'analytics' ? 'sovereign' : 'analytics');
  };

  const isDark = theme === 'analytics';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (err: any) {
      setError(err?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background text-on-surface p-6" data-theme={theme}>
      {/* Theme Toggle Floating Button */}
      <div className="absolute top-6 right-6">
        <button
          onClick={toggleTheme}
          title={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          className="p-2 rounded-full border border-outline-variant bg-surface-container hover:bg-surface-container-high transition-colors"
        >
          {isDark ? (
            <Sun size={20} className="text-primary" />
          ) : (
            <Moon size={20} className="text-primary" />
          )}
        </button>
      </div>

      <div className="w-full max-w-md stitch-glass-card rounded-xl p-8 border border-outline-variant">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <svg viewBox="0 0 32 32" fill="none" className="w-6 h-6">
              <path d="M4 8h24v3H4zM4 14.5h16v3H4zM4 21h10v3H4z" fill="currentColor" className="text-primary" />
              <circle cx="25" cy="22.5" r="5" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-primary opacity-70" />
              <line x1="28.5" y1="26" x2="31" y2="28.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-primary" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-black text-on-surface">FAGE Workbench</h1>
            <p className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">Sign in to continue</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-error-container text-on-error-container text-xs font-bold">
              {error}
            </div>
          )}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant block mb-1">Username</label>
            <input
              className="w-full px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant text-on-surface outline-none focus:border-primary text-sm"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant block mb-1">Password</label>
            <input
              type="password"
              className="w-full px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant text-on-surface outline-none focus:border-primary text-sm"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-primary text-on-primary font-bold text-sm disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-[10px] text-on-surface-variant leading-relaxed text-center">
          Demo accounts:{' '}
          <span 
            className="whitespace-nowrap cursor-pointer hover:opacity-80 transition-opacity" 
            onClick={() => { setUsername('admin'); setPassword('admin123'); }}
          >
            <code className="text-primary hover:underline">admin / admin123</code>
          </span>,{' '}
          <span 
            className="whitespace-nowrap cursor-pointer hover:opacity-80 transition-opacity" 
            onClick={() => { setUsername('analyst'); setPassword('analyst123'); }}
          >
            <code className="text-primary hover:underline">analyst / analyst123</code>
          </span>,{' '}
          <span 
            className="whitespace-nowrap cursor-pointer hover:opacity-80 transition-opacity" 
            onClick={() => { setUsername('auditor'); setPassword('auditor123'); }}
          >
            <code className="text-primary hover:underline">auditor / auditor123</code>
          </span>
        </p>
      </div>
    </div>
  );
}
