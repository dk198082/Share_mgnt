import type { CertificateRow, ShareholderRow, ShareTransferRow, TransferRequestRow } from "@workspace/db";
import { outstandingTotal, presentCertificate, remainingShares } from "./certificates";
import { awaitingSigner } from "./approval-policy";
import type { ApprovalSigner } from "@workspace/db";
import { transferSources } from "./transfers";

export function needsSignoff(row: TransferRequestRow, actor: string, emails: string[], fallback: ApprovalSigner[] = []) {
  return awaitingSigner(row, { id: actor, emails }, fallback);
}
export function certificateDirectory(certificates: CertificateRow[], shareholders: ShareholderRow[], transfers: ShareTransferRow[]) {
  const holders = new Map(shareholders.map(h => [h.id, h]));
  const companyShares = outstandingTotal(certificates);
  return certificates.map(row => {
    const name = String(holders.get(row.shareholderId)?.data.name ?? "Unknown shareholder");
    const active = remainingShares(row) > 0;
    return {
      ...presentCertificate(row, companyShares),
      currentHolderId: active ? row.shareholderId : null, currentHolderName: active ? name : null,
      originalHolderId: row.shareholderId, originalHolderName: name,
      successors: transfers.filter(t => transferSources(t).some(s => s.certificateId === row.id)).map(t => ({
        certificateId: t.recipientCertificateId, shareholderId: t.recipientId,
        shareholderName: String(holders.get(t.recipientId)?.data.name ?? t.recipientName), quantity: transferSources(t).find(s => s.certificateId === row.id)!.quantity,
      })),
    };
  });
}
