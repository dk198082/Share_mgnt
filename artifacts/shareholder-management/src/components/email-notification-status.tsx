import { useState } from 'react';
import { useRetrySignoffEmailNotifications, type EmailNotificationSummary } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { errMsg } from '@/lib/format';

export function EmailNotificationStatus({ requestId, initialSummary }: {
  requestId: string;
  initialSummary: EmailNotificationSummary;
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const retry = useRetrySignoffEmailNotifications();
  const retryEmails = () => {
    setError('');
    retry.mutate({ requestId }, {
      onSuccess: setSummary,
      onError: (err) => setError(errMsg(err, 'The email retry failed. The approval request is still available.')),
    });
  };
  const copyLink = async () => {
    const link = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/sign-off-requests/${encodeURIComponent(requestId)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
      setError('Could not copy the link. Open the approval request and copy its address.');
    }
  };

  let message: string;
  if (summary.total === 0) message = 'No email was queued for this request. Share the approval link with signers manually.';
  else if (summary.pending > 0) message = 'Outlook notifications are still processing.';
  else if (summary.accepted === summary.total) message = `Outlook accepted email for all ${summary.total} signer${summary.total === 1 ? '' : 's'}. Acceptance does not confirm delivery.`;
  else if (summary.unknown > 0) message = `Outlook accepted ${summary.accepted} of ${summary.total} signer emails but could not confirm ${summary.unknown}. Check Outlook Sent Items before retrying; the request remains pending.`;
  else if (summary.failed > 0) message = `Outlook accepted ${summary.accepted} of ${summary.total} signer emails. The request remains pending; retry the failed email${summary.failed === 1 ? '' : 's'} or share the link manually.`;
  else message = 'The request closed before all notifications were sent.';

  const needsFallback = summary.total === 0 || summary.failed > 0 || summary.unknown > 0;
  return (
    <div className="space-y-2 rounded-md border border-border bg-background/70 p-3 text-xs text-muted-foreground" role="status" aria-live="polite" data-testid="email-notification-status">
      <p>{message}</p>
      {error && <p className="text-destructive">{error}</p>}
      {needsFallback && (
        <div className="flex flex-wrap gap-2">
          {summary.failed > 0 && summary.pending === 0 && (
            <Button type="button" variant="outline" size="sm" disabled={retry.isPending} onClick={retryEmails} data-testid="button-retry-signoff-email">
              {retry.isPending ? 'Retrying…' : 'Retry failed emails'}
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={copyLink} data-testid="button-copy-signoff-link">
            {copied ? 'Link copied' : 'Copy approval link'}
          </Button>
        </div>
      )}
    </div>
  );
}
