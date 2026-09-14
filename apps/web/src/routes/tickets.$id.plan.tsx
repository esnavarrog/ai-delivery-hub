import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { PlanPageContainer } from '@/features/plan/PlanPageContainer';

const searchSchema = z.object({ version: z.string().min(1).optional() });

export const Route = createFileRoute('/tickets/$id/plan')({
  validateSearch: (search) => searchSchema.parse(search),
  component: PlanRoute,
});

function PlanRoute() {
  const { id } = Route.useParams();
  const { version } = Route.useSearch();
  const navigate = Route.useNavigate();
  return <PlanPageContainer ticketId={id} versionId={version} onVersionChange={(v) => void navigate({ search: { version: v } })} />;
}
