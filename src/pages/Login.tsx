import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Cloud,
  Eye,
  EyeOff,
  Headset,
  LayoutGrid,
  Lock,
  LogIn,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { Logo } from '../components/Logo';
import { useAuth } from '../context/AuthContext';
import { homePathForRole } from '../types';
import { parseLoginId } from '../lib/loginAuth';

const FEATURES = [
  { icon: LayoutGrid, label: 'All in One Platform' },
  { icon: ShieldCheck, label: 'Secure & Reliable' },
  { icon: BarChart3, label: 'Smart Insights' },
  { icon: Headset, label: '24x7 Support' },
  { icon: Cloud, label: 'Cloud Enabled' },
] as const;

export const Login: React.FC = () => {
  const { login, user, loading } = useAuth();
  const navigate = useNavigate();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && user) {
      navigate(homePathForRole(user.role), { replace: true });
    }
  }, [user, loading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!parseLoginId(loginId)) {
      setError('Enter a valid email, phone, Aadhaar, or User ID.');
      return;
    }
    setSubmitting(true);
    try {
      await login(loginId, password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="login-hero">
        <div className="loader-ring" />
      </div>
    );
  }

  return (
    <div className="login-hero">
      <div className="login-hero__inner">
        <header className="login-hero__brand">
          <Logo size="lg" className="login-hero__logo" />
          <h1 className="login-hero__welcome">Welcome to YesOne</h1>
          <p className="login-hero__tagline">One platform. Unlimited possibilities.</p>
        </header>

        <ul className="login-hero__features" aria-label="Platform highlights">
          {FEATURES.map(({ icon: Icon, label }, index) => (
            <li key={label} className="login-hero__feature">
              {index > 0 && <span className="login-hero__feature-rule" aria-hidden />}
              <Icon size={22} strokeWidth={1.75} aria-hidden />
              <span>{label}</span>
            </li>
          ))}
        </ul>

        <div className="login-hero__form-wrap">
          <h2 className="login-hero__signin-title">
            Sign in with your{' '}
            <span className="login-hero__signin-accent">ID and password</span>
          </h2>

          <form onSubmit={handleSubmit} className="login-hero__form">
            {error && <div className="login-error">{error}</div>}

            <div className="form-group">
              <label htmlFor="login-id">Login ID</label>
              <div className="input-icon-wrap">
                <UserRound size={18} className="input-icon" strokeWidth={1.75} />
                <input
                  id="login-id"
                  type="text"
                  className="input-field input-with-icon login-hero__input"
                  placeholder="Email, phone, Aadhaar, or User ID"
                  value={loginId}
                  onChange={e => setLoginId(e.target.value)}
                  required
                  autoFocus
                  autoComplete="username"
                />
              </div>
              <p className="login-hero__hint">
                Use your email, 10-digit mobile number, or 12-digit Aadhaar
              </p>
            </div>

            <div className="form-group login-hero__password-group">
              <label htmlFor="login-password">Password</label>
              <div className="input-icon-wrap">
                <Lock size={18} className="input-icon" strokeWidth={1.75} />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  className="input-field input-with-icon login-hero__input"
                  placeholder="Enter your password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="input-icon-right"
                  onClick={() => setShowPassword(p => !p)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <div className="login-hero__forgot-row">
                <Link to="/dealer-login?mode=reset" className="login-hero__forgot">
                  Forgot password?
                </Link>
              </div>
            </div>

            <button
              type="submit"
              className="login-hero__submit"
              disabled={submitting}
            >
              {submitting
                ? <span className="spinner-inline login-hero__spinner" />
                : (
                  <>
                    <LogIn size={20} strokeWidth={2.25} aria-hidden />
                    Sign In
                  </>
                )}
            </button>
          </form>
        </div>

        <footer className="login-hero__bottom-bar">
          <span className="login-hero__bottom-title">Dealer</span>
          <Link to="/dealer-login" className="login-hero__bottom-link">
            Activate your account
          </Link>
        </footer>
      </div>
    </div>
  );
};
