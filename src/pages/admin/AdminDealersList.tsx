import { Route, Routes } from 'react-router-dom';
import { DealerDetailPage } from '../dealers/DealerDetailPage';
import { ZohoDealersPage } from '../dealers/ZohoDealersPage';

export const AdminDealersList = () => (
  <Routes>
    <Route index element={<ZohoDealersPage />} />
    <Route path=":dealerId" element={<DealerDetailPage />} />
  </Routes>
);
