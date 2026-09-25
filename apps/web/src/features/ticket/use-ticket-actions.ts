import type { TicketDetailResponse } from '@ai-delivery-hub/contracts';
import { useCallback, useState } from 'react';
import { useTicketCommand, type TicketCommand } from '@/app/queries';
import type { ActionId, ResolvedAction } from '@/lib/action-resolver';

export type DialogId = 'approve' | 'request_changes' | 'confirm_triage' | 'reject' | 'duplicate' | 'already_implemented' | 'reopen' | 'replan' | 'stop' | 'answer_questions';

/** Maps a resolved action to either an immediate command or a dialog; the container renders the dialog. */
export function useTicketActions(detail: TicketDetailResponse | undefined, options: { requiresSecondApprover: boolean; onAddComment: () => void }) {
  const ticketId = detail?.ticket.id ?? '';
  const [dialog, setDialog] = useState<DialogId | null>(null);
  const mutation = useTicketCommand(ticketId, { onSuccess: () => setDialog(null) });

  const send = useCallback((command: TicketCommand) => mutation.mutate(command), [mutation]);

  const onAction = useCallback(
    (action: ResolvedAction) => {
      if (action.disabledReason) return;
      const id: ActionId = action.id;
      switch (id) {
        case 'claim':
          return send({ kind: 'claim' });
        case 'retriage':
          return send({ kind: 'retriage' });
        case 'pause':
          return send({ kind: 'flag', body: { flag: 'paused', set: true } });
        case 'resume':
          return send({ kind: 'flag', body: { flag: 'paused', set: false } });
        case 'approve':
          return options.requiresSecondApprover ? setDialog('approve') : send({ kind: 'approve', body: {} });
        case 'add_comment':
          return options.onAddComment();
        case 'stop':
        case 'request_changes':
        case 'confirm_triage':
        case 'reject':
        case 'duplicate':
        case 'already_implemented':
        case 'reopen':
        case 'replan':
        case 'answer_questions':
          return setDialog(id);
      }
    },
    [send, options],
  );

  return { dialog, setDialog, onAction, send, busy: mutation.isPending };
}
