import type { PlanCommentDto } from '@ai-delivery-hub/contracts';
import type { SectionPath } from '@ai-delivery-hub/domain';
import { CheckCircle2, MessageSquarePlus } from 'lucide-react';
import { useState } from 'react';
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
        <ul className="flex flex-col gap-2" aria-label={`Comments on ${sectionPath}`}>
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
                        addressed in v{c.resolvedByVersion}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-warning/50 text-warning-foreground dark:text-warning">
                        unresolved
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
                </div>
                {!resolved && canResolve ? (
                  <Button variant="ghost" size="sm" className="shrink-0" disabled={busy} onClick={() => onResolve(c.id)} aria-label={`Resolve comment by ${c.authorId}`}>
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    Resolve
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
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="What should change in this section?" aria-label={`Comment on ${sectionPath}`} rows={3} autoFocus />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy || body.trim().length === 0}>
                Post comment
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={() => setOpen(true)} aria-label={`Comment on ${sectionPath}`}>
            <MessageSquarePlus className="size-4" aria-hidden="true" />
            Comment
          </Button>
        )
      ) : null}
    </div>
  );
}
