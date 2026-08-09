import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

const functions = getFunctions(app, 'asia-south1');

export interface RaiseLogisticsIssueTicketInput {
  bookingId: string;
  description: string;
}

export interface RaiseLogisticsIssueTicketResult {
  requestId: string;
  requestNumber: string;
  supportRequestId: string;
  supportRequestNumber: string;
  linkedBooking: boolean;
}

export async function raiseLogisticsIssueTicket(
  input: RaiseLogisticsIssueTicketInput,
): Promise<RaiseLogisticsIssueTicketResult> {
  const callable = httpsCallable<
    RaiseLogisticsIssueTicketInput,
    RaiseLogisticsIssueTicketResult
  >(functions, 'raiseLogisticsIssueTicketFn');
  const result = await callable({
    bookingId: input.bookingId.trim(),
    description: input.description.trim(),
  });
  return result.data;
}
