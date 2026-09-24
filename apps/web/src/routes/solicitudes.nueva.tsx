import { createFileRoute } from '@tanstack/react-router';
import { NewRequestContainer } from '@/features/requests/NewRequestContainer';

export const Route = createFileRoute('/solicitudes/nueva')({ component: NewRequestContainer });
