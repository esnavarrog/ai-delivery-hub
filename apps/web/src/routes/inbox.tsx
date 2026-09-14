import { createFileRoute } from '@tanstack/react-router';
import { InboxContainer } from '@/features/inbox/InboxContainer';

export const Route = createFileRoute('/inbox')({ component: InboxContainer });
