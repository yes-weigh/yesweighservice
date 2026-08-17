import React from 'react';

export const OpsPlaceholderPage: React.FC<{
  title: string;
  description: string;
}> = ({ title, description }) => (
  <div className="page-content fade-in">
    <section className="panel glass settings-locations">
      <header className="settings-locations__header">
        <div>
          <h3>{title}</h3>
          <p className="text-muted text-sm">{description}</p>
        </div>
      </header>
    </section>
  </div>
);
