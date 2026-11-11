import { nf } from './format';

type Source = { certificateId: string; quantity: number };
export function sourceLabel(primary: string, sources?: Source[] | null) {
  return sources?.length ? sources.map(s => `${s.certificateId} (${nf.format(s.quantity)} shares)`).join('; ') : primary;
}
export function usesSource(transfer: { sourceCertificateId: string; sources?: Source[] | null }, id: string) {
  return transfer.sources?.length ? transfer.sources.some(s => s.certificateId === id) : transfer.sourceCertificateId === id;
}
