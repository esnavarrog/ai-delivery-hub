import { createFileRoute } from '@tanstack/react-router';
import { MyRequestsContainer } from '@/features/requests/MyRequestsContainer';

export const Route = createFileRoute('/solicitudes/')({ component: MyRequestsContainer });
