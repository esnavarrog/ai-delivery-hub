import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmTriageDialog } from '@/features/ticket/dialogs';
import { ticket } from '../fixtures/ticket';

async function chooseSelectOption(label: string | RegExp, optionName: string | RegExp) {
  await userEvent.click(screen.getByRole('combobox', { name: label }));
  await userEvent.click(await screen.findByRole('option', { name: optionName }));
}

describe('ConfirmTriageDialog', () => {
  it('hides the score section when the ticket has no assessment yet', () => {
    render(<ConfirmTriageDialog open busy={false} onOpenChange={vi.fn()} ticket={ticket()} repos={[]} onConfirm={vi.fn()} />);
    expect(screen.queryByText('Puntaje RICE')).not.toBeInTheDocument();
  });

  it('shows the current RICE score live and does not send scores when unchanged', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmTriageDialog
        open
        busy={false}
        onOpenChange={vi.fn()}
        ticket={ticket({ category: 'feature', riskTier: 'medium', targetRepo: 'backend-parkingapp' })}
        repos={['backend-parkingapp']}
        initialScores={{ value: 4, reach: 3, confidence: 0.8, effort: 'M' }}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText(/Puntaje RICE con estos valores: 4.8/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar triaje' }));
    expect(onConfirm).toHaveBeenCalledWith({});
  });

  it('recomputes RICE live and sends the full scores object once a field changes', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmTriageDialog
        open
        busy={false}
        onOpenChange={vi.fn()}
        ticket={ticket({ category: 'feature', riskTier: 'medium', targetRepo: 'backend-parkingapp' })}
        repos={['backend-parkingapp']}
        initialScores={{ value: 4, reach: 3, confidence: 0.8, effort: 'M' }}
        onConfirm={onConfirm}
      />,
    );
    await chooseSelectOption('Valor (1-5)', '5');
    expect(screen.getByText(/Puntaje RICE con estos valores: 6/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar triaje' }));
    expect(onConfirm).toHaveBeenCalledWith({ scores: { value: 5, reach: 3, confidence: 0.8, effort: 'M' } });
  });
});
