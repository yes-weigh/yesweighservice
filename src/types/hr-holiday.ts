export const HR_HOLIDAY_TYPES = ['public', 'company', 'optional'] as const;

export type HrHolidayType = (typeof HR_HOLIDAY_TYPES)[number];

export const HR_HOLIDAY_TYPE_LABELS: Record<HrHolidayType, string> = {
  public: 'Public holiday',
  company: 'Company holiday',
  optional: 'Optional / restricted',
};

export interface HrHoliday {
  id: string;
  date: string;
  name: string;
  type: HrHolidayType;
  note?: string | null;
  createdAt: string;
  createdByUid?: string | null;
}

export interface HrHolidayInput {
  date: string;
  name: string;
  type: HrHolidayType;
  note?: string | null;
}
