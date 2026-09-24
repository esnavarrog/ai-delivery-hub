import { Department, Frequency, ManualIntake } from '@ai-delivery-hub/domain';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useCreateTicket } from '@/app/queries';
import { es } from '@/i18n/es';
import { departmentLabels, frequencyLabels } from '@/i18n/labels';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { PageHeader } from '@/ui/page-header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Textarea } from '@/ui/textarea';

/** Problem-first intake form for `/solicitudes/nueva`; mirrors the `ManualIntake` domain schema. */
export function NewRequestContainer() {
  const navigate = useNavigate();
  const createTicket = useCreateTicket();

  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [problem, setProblem] = useState('');
  const [affected, setAffected] = useState('');
  const [frequency, setFrequency] = useState('');
  const [currentWorkaround, setCurrentWorkaround] = useState('');
  const [expectedOutcome, setExpectedOutcome] = useState('');
  const [successMetric, setSuccessMetric] = useState('');
  const [deadline, setDeadline] = useState('');
  const [deadlineReason, setDeadlineReason] = useState('');
  const [description, setDescription] = useState('');
  const [touched, setTouched] = useState(false);

  const intakeCandidate = {
    department,
    problem: problem.trim(),
    affected: affected.trim(),
    frequency,
    currentWorkaround: currentWorkaround.trim(),
    expectedOutcome: expectedOutcome.trim(),
    ...(successMetric.trim() ? { successMetric: successMetric.trim() } : {}),
    ...(deadline.trim() ? { deadline: deadline.trim() } : {}),
    ...(deadlineReason.trim() ? { deadlineReason: deadlineReason.trim() } : {}),
  };
  const intakeResult = ManualIntake.safeParse(intakeCandidate);
  const titleValid = title.trim().length > 0;
  const canSubmit = titleValid && intakeResult.success && !createTicket.isPending;
  const showValidation = touched && !canSubmit;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!titleValid || !intakeResult.success || createTicket.isPending) return;
    const builtDescription =
      description.trim() ||
      [
        problem.trim(),
        `${es.requestForm.affectedLabel} ${affected.trim()}`,
        `${es.requestForm.currentWorkaroundLabel} ${currentWorkaround.trim()}`,
        `${es.requestForm.expectedOutcomeLabel} ${expectedOutcome.trim()}`,
      ].join('\n\n');
    createTicket.mutate(
      { title: title.trim(), description: builtDescription, intake: intakeResult.data },
      { onSuccess: () => void navigate({ to: '/solicitudes' }) },
    );
  };

  return (
    <div>
      <PageHeader title={es.requestForm.title} description={es.requestForm.description} />
      <form className="flex max-w-2xl flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <label className="flex flex-col gap-1 text-sm">
          {es.requestForm.titleLabel}
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={es.requestForm.titlePlaceholder} aria-invalid={touched && !titleValid} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {es.requestForm.departmentLabel}
          <Select value={department} onValueChange={setDepartment}>
            <SelectTrigger aria-label={es.requestForm.departmentLabel} aria-invalid={touched && department.length === 0}>
              <SelectValue placeholder={es.requestForm.departmentPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {Department.options.map((d) => (
                <SelectItem key={d} value={d}>
                  {departmentLabels[d]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {es.requestForm.problemLabel}
          <Textarea value={problem} onChange={(e) => setProblem(e.target.value)} rows={3} placeholder={es.requestForm.problemPlaceholder} aria-invalid={touched && problem.trim().length === 0} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {es.requestForm.affectedLabel}
          <Input value={affected} onChange={(e) => setAffected(e.target.value)} placeholder={es.requestForm.affectedPlaceholder} aria-invalid={touched && affected.trim().length === 0} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {es.requestForm.frequencyLabel}
          <Select value={frequency} onValueChange={setFrequency}>
            <SelectTrigger aria-label={es.requestForm.frequencyLabel} aria-invalid={touched && frequency.length === 0}>
              <SelectValue placeholder={es.requestForm.frequencyPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {Frequency.options.map((f) => (
                <SelectItem key={f} value={f}>
                  {frequencyLabels[f]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {es.requestForm.currentWorkaroundLabel}
          <Textarea
            value={currentWorkaround}
            onChange={(e) => setCurrentWorkaround(e.target.value)}
            rows={3}
            placeholder={es.requestForm.currentWorkaroundPlaceholder}
            aria-invalid={touched && currentWorkaround.trim().length === 0}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {es.requestForm.expectedOutcomeLabel}
          <Textarea
            value={expectedOutcome}
            onChange={(e) => setExpectedOutcome(e.target.value)}
            rows={3}
            placeholder={es.requestForm.expectedOutcomePlaceholder}
            aria-invalid={touched && expectedOutcome.trim().length === 0}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {es.requestForm.successMetricLabel}
          {es.requestForm.successMetricOptional}
          <Input value={successMetric} onChange={(e) => setSuccessMetric(e.target.value)} placeholder={es.requestForm.successMetricPlaceholder} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {es.requestForm.deadlineLabel}
          {es.requestForm.deadlineOptional}
          <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>
        {deadline.trim() ? (
          <label className="flex flex-col gap-1 text-sm">
            {es.requestForm.deadlineReasonLabel}
            <Input value={deadlineReason} onChange={(e) => setDeadlineReason(e.target.value)} placeholder={es.requestForm.deadlineReasonPlaceholder} />
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-sm">
          {es.requestForm.descriptionLabel}
          {es.requestForm.descriptionOptional}
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder={es.requestForm.descriptionPlaceholder} />
        </label>
        {showValidation ? <p className="text-sm text-destructive">{es.requestForm.required}</p> : null}
        <div>
          <Button type="submit" disabled={createTicket.isPending}>
            {createTicket.isPending ? es.requestForm.submitting : es.requestForm.submit}
          </Button>
        </div>
      </form>
    </div>
  );
}
