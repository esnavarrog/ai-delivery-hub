import type { ApproveBody, ConfirmTriageBody, DuplicateBody, RequestChangesBody } from '@ai-delivery-hub/contracts';
import { RiskTier, TicketCategory, type TicketSnapshot } from '@ai-delivery-hub/domain';
import { useState } from 'react';
import { es } from '@/i18n/es';
import { riskTierLabels, ticketCategoryLabels } from '@/i18n/labels';
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
              {es.dialogs.duplicateOfLabel}
              <Input value={duplicateOf} onChange={(e) => setDuplicateOf(e.target.value)} placeholder={es.dialogs.duplicateOfPlaceholder} />
            </label>
          ) : null}
          <label className="flex flex-col gap-1 text-sm">
            {es.dialogs.reasonLabel}
            {reasonRequired ? '' : es.dialogs.optionalSuffix}
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={es.dialogs.reasonPlaceholder} />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {es.dialogs.cancel}
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
          <DialogTitle>{es.dialogs.requestChanges.title}</DialogTitle>
          <DialogDescription>
            {unresolvedComments > 0 ? es.dialogs.requestChanges.descriptionWithComments(unresolvedComments) : es.dialogs.requestChanges.descriptionWithoutComments}
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
            {es.dialogs.reasonLabel}
            {reasonRequired ? '' : es.dialogs.optionalSuffix}
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} autoFocus placeholder={es.dialogs.requestChanges.reasonPlaceholder} />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {es.dialogs.cancel}
            </Button>
            <Button type="submit" disabled={!canConfirm}>
              {es.dialogs.requestChanges.confirm}
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
          <DialogTitle>{es.dialogs.approve.title}</DialogTitle>
          <DialogDescription>{es.dialogs.approve.description}</DialogDescription>
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
            {es.dialogs.approve.secondApproverLabel}
            <Input value={second} onChange={(e) => setSecond(e.target.value)} placeholder="usuario de github" autoFocus aria-invalid={sameAsMe} />
            {sameAsMe ? <span className="text-xs text-destructive">{es.dialogs.approve.secondApproverSameError}</span> : null}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {es.dialogs.approve.noteLabel}
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {es.dialogs.cancel}
            </Button>
            <Button type="submit" disabled={!canConfirm}>
              {es.dialogs.approve.confirm}
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
          <DialogTitle>{es.dialogs.confirmTriage.title}</DialogTitle>
          <DialogDescription>{es.dialogs.confirmTriage.description}</DialogDescription>
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
            {es.dialogs.confirmTriage.categoryLabel}
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger aria-label={es.dialogs.confirmTriage.categoryLabel}>
                <SelectValue placeholder={es.dialogs.confirmTriage.categoryLabel} />
              </SelectTrigger>
              <SelectContent>
                {TicketCategory.options.map((c) => (
                  <SelectItem key={c} value={c}>
                    {ticketCategoryLabels[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {es.dialogs.confirmTriage.riskLabel}
            <Select value={risk} onValueChange={setRisk}>
              <SelectTrigger aria-label={es.dialogs.confirmTriage.riskLabel}>
                <SelectValue placeholder={es.dialogs.confirmTriage.riskLabel} />
              </SelectTrigger>
              <SelectContent>
                {RiskTier.options.map((r) => (
                  <SelectItem key={r} value={r}>
                    {riskTierLabels[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {es.dialogs.confirmTriage.repositoryLabel}
            {repoOptions.length > 1 ? (
              <Select value={repo} onValueChange={setRepo}>
                <SelectTrigger aria-label={es.dialogs.confirmTriage.repositoryLabel}>
                  <SelectValue placeholder={es.dialogs.confirmTriage.repositoryLabel} />
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
              <Input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder={es.dialogs.confirmTriage.repositoryPlaceholder} aria-label={es.dialogs.confirmTriage.repositoryLabel} />
            )}
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {es.dialogs.cancel}
            </Button>
            <Button type="submit" disabled={busy}>
              {es.dialogs.confirmTriage.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
