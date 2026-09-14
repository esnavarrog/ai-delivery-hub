import { createFileRoute } from '@tanstack/react-router';
import { TicketPageContainer } from '@/features/ticket/TicketPageContainer';

export const Route = createFileRoute('/tickets/$id/')({
  component: () => {
    const { id } = Route.useParams();
    return <TicketPageContainer ticketId={id} />;
  },
});
