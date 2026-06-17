import React from 'react';
import { PagePlaceholder } from '../../components/PagePlaceholder';
import { useAuth } from '../../context/AuthContext';
import { homePathForRole } from '../../types';
import { DealerDashboard } from './DealerDashboard';
import { OrdersPage } from './OrdersPage';
import { ProductsPage } from './ProductsPage';
import { SparesPage } from './SparesPage';
import { InvoicesPage } from './InvoicesPage';
import { InvoiceDetailPage } from './InvoiceDetailPage';

function DealerInvoicesRoute() {
  const { user } = useAuth();
  if (user?.role === 'dealer' || user?.role === 'dealer_staff') {
    return <InvoicesPage />;
  }
  return (
    <PagePlaceholder
      title="Invoice"
      description="Create, send, and manage customer invoices and billing records."
    />
  );
}

function DealerInvoiceDetailRoute() {
  const { user } = useAuth();
  if (user?.role === 'dealer' || user?.role === 'dealer_staff') {
    return <InvoiceDetailPage />;
  }
  return (
    <PagePlaceholder
      title="Invoice"
      description="Create, send, and manage customer invoices and billing records."
    />
  );
}

export const RoleDashboard: React.FC = () => {
  const { user } = useAuth();

  if (user?.role === 'dealer' || user?.role === 'dealer_staff') {
    return <DealerDashboard basePath={homePathForRole(user.role)} />;
  }

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
  Returns: () => (
    <PagePlaceholder
      title="Returns"
      description="Process product returns, RMA requests, and return-to-vendor workflows."
    />
  ),
  Complaints: () => (
    <PagePlaceholder
      title="Complaints"
      description="Track and resolve customer complaints and follow-up actions."
    />
  ),
  Invoices: DealerInvoicesRoute,
  InvoiceDetail: DealerInvoiceDetailRoute,
  Products: ProductsPage,
  Orders: OrdersPage,
  Spares: SparesPage,
  Verification: () => (
    <PagePlaceholder
      title="Verifications"
      description="Track verification workflows, stamping records, and compliance checkpoints."
    />
  ),
  Advertisements: () => (
    <PagePlaceholder
      title="Advertisement"
      description="Create and manage promotional content and dealership advertisements."
    />
  ),
  Training: () => (
    <PagePlaceholder
      title="Trainings"
      description="Assign and monitor staff training modules and certification progress."
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
      title="AI assistance"
      description="Your YesWeigh AI assistant for service guidance, documentation lookup, and operational support."
    />
  ),
  Leads: () => (
    <PagePlaceholder
      title="Leads"
      description="Track sales leads, inquiries, and follow-ups across dealers and regions."
    />
  ),
  Tasks: () => (
    <PagePlaceholder
      title="Tasks"
      description="Assign, track, and complete daily work items across your team."
    />
  ),
};
