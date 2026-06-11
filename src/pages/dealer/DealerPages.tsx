import React from 'react';
import { PagePlaceholder } from '../../components/PagePlaceholder';
import { useAuth } from '../../context/AuthContext';

export const RoleDashboard: React.FC = () => {
  const { user } = useAuth();
  return (
    <div className="page-content fade-in">
      <div className="panel glass">
        <h2>Welcome, {user?.displayName}</h2>
        <p className="text-muted mt-4">
          YesWeigh Service portal — your workspace for verification, quality, and
          customer operations under the YesWeigh brand.
        </p>
      </div>
    </div>
  );
};

export const DealerMenuPages = {
  Services: () => (
    <PagePlaceholder
      title="Services"
      description="Manage service jobs, appointments, and customer service requests."
    />
  ),
  Complaints: () => (
    <PagePlaceholder
      title="Complaints"
      description="Track and resolve customer complaints and follow-up actions."
    />
  ),
  Invoices: () => (
    <PagePlaceholder
      title="Invoices"
      description="Create, send, and manage customer invoices and billing records."
    />
  ),
  Payments: () => (
    <PagePlaceholder
      title="Payments"
      description="Record payments, track outstanding balances, and reconcile transactions."
    />
  ),
  Products: () => (
    <PagePlaceholder
      title="Products"
      description="Manage weighing products, models, and service catalogues for your dealership."
    />
  ),
  Verification: () => (
    <PagePlaceholder
      title="Verification & Stamping"
      description="Track verification workflows, stamping records, and compliance checkpoints."
    />
  ),
  Advertisements: () => (
    <PagePlaceholder
      title="Advertisements"
      description="Create and manage promotional content and dealership advertisements."
    />
  ),
  Training: () => (
    <PagePlaceholder
      title="Training"
      description="Assign and monitor staff training modules and certification progress."
    />
  ),
  Quality: () => (
    <PagePlaceholder
      title="Quality Management"
      description="ISO-aligned quality checks, audits, and corrective actions."
    />
  ),
  Notifications: () => (
    <PagePlaceholder
      title="Notifications"
      description="Service alerts, renewal reminders, and operational updates."
    />
  ),
  AiAssistant: () => (
    <PagePlaceholder
      title="AI Assistent"
      description="Your YesWeigh AI assistant for service guidance, documentation lookup, and operational support."
    />
  ),
};
