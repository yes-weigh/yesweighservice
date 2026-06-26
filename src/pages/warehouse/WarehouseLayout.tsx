import React from 'react';
import { Outlet } from 'react-router-dom';

export const WarehouseLayout: React.FC = () => (
  <div className="warehouse-shell">
    <Outlet />
  </div>
);
