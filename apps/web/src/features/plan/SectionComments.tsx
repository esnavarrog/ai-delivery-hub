import type { PlanCommentDto } from '@ai-delivery-hub/contracts';
import type { SectionPath } from '@ai-delivery-hub/domain';
import { CheckCircle2, MessageSquarePlus } from 'lucide-react';
import { useState } from 'react';
import { es } from '@/i18n/es';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { RelativeTime } from '@/ui/relative-time';
import { Textarea } from '@/ui/textarea';

export interface SectionCommentsProps {
  sectionPath: SectionPath;
  comments: readonly PlanCommentDto[];
  canComment: boolean;
  canResolve: boolean;
  busy?: boolean;
  onAddComment: (input: { sectionPath: SectionPath; body: string }) => void;
  onResolve: (commentId: string) => void;
}

/** Comment list plus the inline "Comment" affordance for one plan section. */
export function SectionComments({ sectionPath, comments, canComment, canResolve, busy = false, onAddComment, onResolve }: SectionCommentsProps) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');

  const submit = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    onAddComment({ sectionPath, body: trimmed });
    setBody('');
    setOpen(false);
  };

  return (
    <div className="mt-3 flex flex-col gap-2">
      {comments.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label={es.plan.commentsOnSection(sectionPath)}>
          {comments.map((c) => {
            const resolved = c.resolvedByVersion !== null;
            return (
              <li key={c.id} className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm" data-resolved={resolved}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{c.authorId}</span>
                    <RelativeTime iso={c.createdAt} />
                    {resolved ? (
                      <Badge variant="outline" className="border-success/40 text-success">
                        {es.plan.addressedIn(c.resolvedByVersion ?? 0)}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-warning/50 text-warning-foreground dark:text-warning">
                        {es.plan.unresolved}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
                </div>
                {!resolved && canResolve ? (
                  <Button variant="ghost" size="sm" className="shrink-0" disabled={busy} onClick={() => onResolve(c.id)} aria-label={es.plan.resolveAria(c.authorId)}>
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    {es.plan.resolve}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {canComment ? (
        open ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={es.plan.commentPlaceholder} aria-label={es.plan.commentOnSection(sectionPath)} rows={3} autoFocus />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy || body.trim().length === 0}>
                {es.plan.postComment}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                {es.plan.cancel}
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={() => setOpen(true)} aria-label={es.plan.commentOnSection(sectionPath)}>
            <MessageSquarePlus className="size-4" aria-hidden="true" />
            {es.plan.comment}
          </Button>
        )
      ) : null}
    </div>
  );
}
