import type { ClarificationQuestion, TicketEvent } from '@ai-delivery-hub/domain';
import { useState } from 'react';
import { es } from '@/i18n/es';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Textarea } from '@/ui/textarea';

/** Latest `requester_questions_asked` payload, if any: the round and questions still pending an answer. */
export function latestQuestions(events: readonly TicketEvent[]): { round: number; questions: readonly ClarificationQuestion[] } | undefined {
  const found = [...events].reverse().find((e) => e.type === 'requester_questions_asked');
  return found && found.type === 'requester_questions_asked' ? { round: found.payload.round, questions: found.payload.questions } : undefined;
}

export interface AnswerQuestionsDialogProps {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  questions: readonly ClarificationQuestion[];
  onConfirm: (answers: { questionId: string; text: string }[]) => void;
}

/** One textarea per pending clarifying question; every answer is required before it can be sent. */
export function AnswerQuestionsDialog({ open, busy, onOpenChange, questions, onConfirm }: AnswerQuestionsDialogProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const canConfirm = !busy && questions.length > 0 && questions.every((q) => (answers[q.id] ?? '').trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{es.dialogs.answerQuestions.title}</DialogTitle>
          <DialogDescription>{es.dialogs.answerQuestions.description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canConfirm) return;
            onConfirm(questions.map((q) => ({ questionId: q.id, text: (answers[q.id] ?? '').trim() })));
          }}
        >
          {questions.map((q, i) => (
            <label key={q.id} className="flex flex-col gap-1 text-sm">
              <span>
                {es.dialogs.answerQuestions.questionLabel(i + 1)}: {q.text}
              </span>
              <Textarea
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                rows={3}
                aria-label={`${es.dialogs.answerQuestions.questionLabel(i + 1)}: ${q.text}`}
              />
            </label>
          ))}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {es.dialogs.cancel}
            </Button>
            <Button type="submit" disabled={!canConfirm}>
              {es.dialogs.answerQuestions.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
