import { createFileRoute } from '@tanstack/react-router';
import { RunsContainer } from '@/features/runs/RunsContainer';

export const Route = createFileRoute('/runs')({ component: RunsContainer });
