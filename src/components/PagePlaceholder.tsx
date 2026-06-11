import React from 'react';
import { Sparkles } from 'lucide-react';

interface PagePlaceholderProps {
  title: string;
  description: string;
}

export const PagePlaceholder: React.FC<PagePlaceholderProps> = ({ title, description }) => (
  <div className="page-content fade-in">
    <div className="panel glass placeholder-panel">
      <Sparkles size={40} className="placeholder-icon" />
      <h2>{title}</h2>
      <p className="text-muted">{description}</p>
    </div>
  </div>
);
