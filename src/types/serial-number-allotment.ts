export type SerialNumberAllotment = {
  id: string;
  from: string;
  to: string;
  missing: string[];
  count: number;
  createdAt: string;
};

export type SerialNumberAllotmentDoc = {
  allotments: SerialNumberAllotment[];
  updatedAt: string | null;
  updatedBy: string | null;
};
