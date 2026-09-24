import type { PlanVersionDto } from '@ai-delivery-hub/contracts';
import { es } from '@/i18n/es';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';

export function VersionSwitcher({ versions, selectedId, onSelect }: { versions: readonly PlanVersionDto[]; selectedId: string; onSelect: (id: string) => void }) {
  const ordered = [...versions].sort((a, b) => b.version - a.version);
  return (
    <Select value={selectedId} onValueChange={onSelect}>
      <SelectTrigger className="w-44" aria-label={es.plan.versionAria}>
        <SelectValue placeholder={es.plan.versionPlaceholder} />
      </SelectTrigger>
      <SelectContent>
        {ordered.map((v) => (
          <SelectItem key={v.id} value={v.id}>
            v{v.version} · {v.status}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
