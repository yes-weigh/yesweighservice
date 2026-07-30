import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Cloud,
  Eye,
  EyeOff,
  LayoutGrid,
  Lock,
  LogIn,
  Phone,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { Logo } from '../components/Logo';
import { BRAND_TITLE, FIRM_NAME } from '../constants/brand';
import { useAuth } from '../context/AuthContext';
import { landingPathForRole } from '../types';
import { parseLoginId } from '../lib/loginAuth';
import {
  NO_AUTOFILL_FORM_PROPS,
  NO_AUTOFILL_LOGIN_ID_PROPS,
  NO_AUTOFILL_PASSWORD_PROPS,
} from '../lib/disableAutofill';

const SUPPORT_PHONE = '919567933252';
const SUPPORT_TEL_HREF = `tel:+${SUPPORT_PHONE}`;
const SUPPORT_WHATSAPP_HREF = `https://wa.me/${SUPPORT_PHONE}`;

const FEATURES = [
  { icon: LayoutGrid, label: 'All in One Platform' },
  { icon: ShieldCheck, label: 'Secure & Reliable' },
  { icon: BarChart3, label: 'Smart Insights' },
  { icon: Cloud, label: 'Cloud Enabled' },
] as const;

function WhatsAppGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      className="login-hero__whatsapp-icon"
    >
      <path
        fill="currentColor"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"
      />
    </svg>
  );
}

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
          <Logo size="md" className="login-hero__logo" />
          <h1 className="login-hero__welcome">Welcome to YesOne</h1>
          <p className="login-hero__tagline">One platform. Unlimited possibilities.</p>
        </header>

        <ul className="login-hero__features" aria-label="Platform highlights">
          {FEATURES.map(({ icon: Icon, label }, index) => (
            <li key={label} className="login-hero__feature">
              {index > 0 && <span className="login-hero__feature-rule" aria-hidden />}
              <Icon size={18} strokeWidth={1.75} aria-hidden />
              <span>{label}</span>
            </li>
          ))}
        </ul>

        <div className="login-hero__form-wrap">
          <h2 className="login-hero__signin-title">
            Sign in with your{' '}
            <span className="login-hero__signin-accent">ID and password</span>
          </h2>

          <form onSubmit={handleSubmit} className="login-hero__form" {...NO_AUTOFILL_FORM_PROPS}>
            {error && <div className="login-error">{error}</div>}

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

        <div className="login-hero__bottom-bar">
          <span className="login-hero__bottom-title">Dealer</span>
          <Link to="/dealer-login" className="login-hero__bottom-link">
            Activate your account
          </Link>
        </div>

        <section className="login-hero__help" aria-label="Need help">
          <h3 className="login-hero__help-title">Need help?</h3>
          <div className="login-hero__help-actions">
            <a
              href={SUPPORT_TEL_HREF}
              className="login-hero__help-btn login-hero__help-btn--call"
            >
              <Phone size={18} strokeWidth={1.85} aria-hidden />
              <span className="login-hero__help-btn-text">
                <strong>Call Us</strong>
                <span>Talk to us</span>
              </span>
            </a>
            <a
              href={SUPPORT_WHATSAPP_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className="login-hero__help-btn login-hero__help-btn--whatsapp"
            >
              <WhatsAppGlyph size={18} />
              <span className="login-hero__help-btn-text">
                <strong>WhatsApp</strong>
                <span>Chat with us</span>
              </span>
            </a>
          </div>
        </section>

        <footer className="login-hero__trust">
          <p className="login-hero__trust-safe">
            <ShieldCheck size={15} strokeWidth={2} aria-hidden />
            Your data is secured
          </p>
          <p className="login-hero__trust-copy">
            © {BRAND_TITLE} · {FIRM_NAME.toUpperCase()}
          </p>
        </footer>
      </div>
    </div>
  );
};
