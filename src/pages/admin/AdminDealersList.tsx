import { Route, Routes } from 'react-router-dom';
import { AdminDealerTeamPage } from '../dealers/AdminDealerTeamPage';
import { DealerDetailPage } from '../dealers/DealerDetailPage';
import ZohoDealersPage from '../dealers/ZohoDealersPage';

export const AdminDealersList = () => (
  <Routes>
    <Route index element={<ZohoDealersPage />} />
    <Route path=":dealerId" element={<DealerDetailPage />} />
    <Route path=":dealerId/team" element={<AdminDealerTeamPage />} />
  </Routes>
);
