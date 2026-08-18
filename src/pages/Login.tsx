import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, LogIn, UserRound } from 'lucide-react';
import { DevQuickLogin } from '../components/auth/DevQuickLogin';
import {
  LoginHeroFeatures,
  LoginHeroHelp,
  LoginHeroTrust,
} from '../components/auth/LoginHeroChrome';
import { Logo } from '../components/Logo';
import { useAuth } from '../context/AuthContext';
import { landingPathForRole } from '../types';
import { parseLoginId } from '../lib/loginAuth';
import {
  NO_AUTOFILL_FORM_PROPS,
  NO_AUTOFILL_LOGIN_ID_PROPS,
  NO_AUTOFILL_PASSWORD_PROPS,
} from '../lib/disableAutofill';

export const Login: React.FC = () => {
  const { login, user, loading } = useAuth();
  const navigate = useNavigate();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  /** Blocks Chrome credential UI until the user interacts with the field. */
  const [loginIdEditable, setLoginIdEditable] = useState(false);
  const [passwordEditable, setPasswordEditable] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      navigate(landingPathForRole(user.role), { replace: true });
    }
  }, [user, loading, navigate]);

  const signInWithCredentials = useCallback(async (nextLoginId: string, nextPassword: string) => {
    setError('');
    if (!parseLoginId(nextLoginId)) {
      setError('Enter a valid email, phone, Aadhaar, or User ID.');
      return;
    }
    setSubmitting(true);
    try {
      await login(nextLoginId, nextPassword);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }, [login]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await signInWithCredentials(loginId, password);
  };

  const handleDevQuickPick = useCallback((nextLoginId: string, nextPassword: string) => {
    setLoginId(nextLoginId);
    setPassword(nextPassword);
    setLoginIdEditable(true);
    setPasswordEditable(true);
    void signInWithCredentials(nextLoginId, nextPassword);
  }, [signInWithCredentials]);

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
          <Logo size="md" className="login-hero__logo" />
          <h1 className="login-hero__welcome">Welcome to YesOne</h1>
          <p className="login-hero__tagline">One platform. Unlimited possibilities.</p>
        </header>

        <LoginHeroFeatures />

        <div className="login-hero__form-wrap">
          <h2 className="login-hero__signin-title">
            Sign in with your{' '}
            <span className="login-hero__signin-accent">ID and password</span>
          </h2>

          <form onSubmit={handleSubmit} className="login-hero__form" {...NO_AUTOFILL_FORM_PROPS}>
            {error && <div className="login-error">{error}</div>}

            {import.meta.env.DEV ? (
              <DevQuickLogin
                disabled={submitting}
                onPick={handleDevQuickPick}
              />
            ) : null}

            <div className="form-group">
              <label htmlFor="login-id">Login ID</label>
              <div className="input-icon-wrap">
                <UserRound size={18} className="input-icon" strokeWidth={1.75} />
                <input
                  id="login-id"
                  name="yw-login-id"
                  type="text"
                  className="input-field input-with-icon login-hero__input"
                  placeholder="Email, phone, Aadhaar, or User ID"
                  value={loginId}
                  onChange={e => setLoginId(e.target.value)}
                  onFocus={() => setLoginIdEditable(true)}
                  readOnly={!loginIdEditable}
                  required
                  autoFocus
                  {...NO_AUTOFILL_LOGIN_ID_PROPS}
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
                  name="yw-login-password"
                  type={showPassword ? 'text' : 'password'}
                  className="input-field input-with-icon login-hero__input"
                  placeholder="Enter your password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onFocus={() => setPasswordEditable(true)}
                  readOnly={!passwordEditable}
                  required
                  {...NO_AUTOFILL_PASSWORD_PROPS}
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
                <Link to="/signup?mode=reset" className="login-hero__forgot">
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

        <div className="login-hero__bottom-bar">
          <span className="login-hero__bottom-title">New dealer</span>
          <Link to="/signup" className="login-hero__bottom-link">
            Create your account
          </Link>
        </div>

        <LoginHeroHelp />
        <LoginHeroTrust />
      </div>
    </div>
  );
};
