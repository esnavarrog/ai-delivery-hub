import type { ApproveBody, ConfirmTriageBody, DuplicateBody, RequestChangesBody } from '@ai-delivery-hub/contracts';
import { RiskTier, TicketCategory, type TicketSnapshot } from '@ai-delivery-hub/domain';
import { useState } from 'react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Textarea } from '@/ui/textarea';

interface BaseDialogProps {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Generic "why?" dialog for reject / duplicate / already implemented / reopen / re-plan / pause. */
export function ReasonDialog({
  open,
  busy,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  reasonRequired = false,
  withDuplicateOf = false,
  onConfirm,
}: BaseDialogProps & {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  reasonRequired?: boolean;
  withDuplicateOf?: boolean;
  onConfirm: (body: DuplicateBody) => void;
}) {
  const [reason, setReason] = useState('');
  const [duplicateOf, setDuplicateOf] = useState('');
  const canConfirm = !busy && (!reasonRequired || reason.trim().length > 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canConfirm) return;
            const body: DuplicateBody = {};
            if (reason.trim()) body.reason = reason.trim();
            if (withDuplicateOf && duplicateOf.trim()) body.duplicateOfTicketId = duplicateOf.trim();
            onConfirm(body);
          }}
        >
          {withDuplicateOf ? (
            <label className="flex flex-col gap-1 text-sm">
              Duplicate of (ticket id, optional)
              <Input value={duplicateOf} onChange={(e) => setDuplicateOf(e.target.value)} placeholder="ticket id" />
            </label>
          ) : null}
          <label className="flex flex-col gap-1 text-sm">
            Reason{reasonRequired ? '' : ' (optional)'}
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Recorded on the timeline and posted to OpenProject" />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={!canConfirm}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RequestChangesDialog({ open, busy, onOpenChange, unresolvedComments, onConfirm }: BaseDialogProps & { unresolvedComments: number; onConfirm: (body: RequestChangesBody) => void }) {
  const [reason, setReason] = useState('');
  const reasonRequired = unresolvedComments === 0;
  const canConfirm = !busy && (!reasonRequired || reason.trim().length > 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request changes</DialogTitle>
          <DialogDescription>
            {unresolvedComments > 0
              ? `${unresolvedComments} unresolved comment(s) will feed the next plan version. Add an overall reason if you want.`
              : 'There are no unresolved comments, so a reason is required. It is sent to the AI for the next version.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canConfirm) return;
            onConfirm(reason.trim() ? { reason: reason.trim() } : {});
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            Reason{reasonRequired ? '' : ' (optional)'}
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} autoFocus placeholder="What must change in the next version?" />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canConfirm}>
              Request changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ApproveDialog({ open, busy, onOpenChange, login, onConfirm }: BaseDialogProps & { login: string; onConfirm: (body: ApproveBody) => void }) {
  const [second, setSecond] = useState('');
  const [note, setNote] = useState('');
  const trimmed = second.trim();
  const sameAsMe = trimmed.length > 0 && trimmed === login;
  const canConfirm = !busy && trimmed.length > 0 && !sameAsMe;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve high-risk plan</DialogTitle>
          <DialogDescription>This ticket touches payments, auth or PII. Name a second approver (a dev, lead or admin other than you) who has reviewed the plan.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canConfirm) return;
            const body: ApproveBody = { secondApproverId: trimmed };
            if (note.trim()) body.note = note.trim();
            onConfirm(body);
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            Second approver login
            <Input value={second} onChange={(e) => setSecond(e.target.value)} placeholder="github login" autoFocus aria-invalid={sameAsMe} />
            {sameAsMe ? <span className="text-xs text-destructive">The second approver must be someone else.</span> : null}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Note (optional)
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canConfirm}>
              Approve plan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Editable override of the AI triage; only changed fields are sent. */
export function ConfirmTriageDialog({ open, busy, onOpenChange, ticket, repos, onConfirm }: BaseDialogProps & { ticket: TicketSnapshot; repos: readonly string[]; onConfirm: (body: ConfirmTriageBody) => void }) {
  const [category, setCategory] = useState<string>(ticket.category ?? '');
  const [risk, setRisk] = useState<string>(ticket.riskTier ?? '');
  const [repo, setRepo] = useState<string>(ticket.targetRepo ?? '');
  const repoOptions = Array.from(new Set([...(ticket.targetRepo ? [ticket.targetRepo] : []), ...repos]));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm triage</DialogTitle>
          <DialogDescription>Keep the AI suggestion or override any field. Planning starts once an owner claims the ticket.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            const body: ConfirmTriageBody = {};
            const cat = TicketCategory.safeParse(category);
            const tier = RiskTier.safeParse(risk);
            if (cat.success && cat.data !== ticket.category) body.category = cat.data;
            if (tier.success && tier.data !== ticket.riskTier) body.riskTier = tier.data;
            if (repo && repo !== ticket.targetRepo) body.targetRepo = repo;
            onConfirm(body);
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            Category
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger aria-label="Category">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {TicketCategory.options.map((c) => (
                  <SelectItem key={c} value={c} className="capitalize">
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Risk tier
            <Select value={risk} onValueChange={setRisk}>
              <SelectTrigger aria-label="Risk tier">
                <SelectValue placeholder="Risk tier" />
              </SelectTrigger>
              <SelectContent>
                {RiskTier.options.map((r) => (
                  <SelectItem key={r} value={r} className="capitalize">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Target repository
            {repoOptions.length > 1 ? (
              <Select value={repo} onValueChange={setRepo}>
                <SelectTrigger aria-label="Target repository">
                  <SelectValue placeholder="Repository" />
                </SelectTrigger>
                <SelectContent>
                  {repoOptions.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="repository name from repos.yaml" aria-label="Target repository" />
            )}
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Confirm triage
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
