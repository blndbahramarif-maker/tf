import {
  loadConversationForViewer,
  markConversationRead,
} from '@/infra/messaging/conversation-service';
import { isUuid, notFound, requireAccess } from '@/lib/api/guards';
import { enforceRateLimit } from '@/lib/api/route-helpers';
import { ok } from '@/lib/api/respond';
import { RATE_LIMITS } from '@/infra/redis/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/conversations/{id}/read — mark a thread read.
 *
 * Read state is per user, keyed on (message, user), so marking a thread read
 * can only ever affect the caller's own receipts.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAccess(request, { all: ['message:read_own'] });
  if (!access.ok) return access.response;

  const viewerId = access.value.principal.userId;
  const limited = await enforceRateLimit(request, RATE_LIMITS.writeApi, viewerId);
  if (!limited.ok) return limited.response;

  const { id } = await context.params;
  if (!isUuid(id)) return notFound(request);

  const conversation = await loadConversationForViewer(id, viewerId);
  if (conversation === null) return notFound(request);

  const marked = await markConversationRead(id, viewerId);
  return ok({ marked });
}
