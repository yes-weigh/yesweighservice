import { Logo } from './Logo';

interface FetchingLoaderProps {
  label?: string;
  className?: string;
}

export const FetchingLoader: React.FC<FetchingLoaderProps> = ({
  label = 'Fetching…',
  className = '',
}) => (
  <div className={`fetching-loader ${className}`.trim()} role="status" aria-live="polite">
    <div className="fetching-loader__visual">
      <div className="fetching-loader__ring" aria-hidden />
      <Logo size="sm" className="fetching-loader__logo" />
    </div>
    <p className="fetching-loader__label">{label}</p>
  </div>
);
