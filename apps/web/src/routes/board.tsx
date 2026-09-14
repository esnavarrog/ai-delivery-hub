import { createFileRoute } from '@tanstack/react-router';
import { BoardContainer } from '@/features/board/BoardContainer';

export const Route = createFileRoute('/board')({ component: BoardContainer });
