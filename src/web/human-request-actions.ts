import type { HumanRequest } from "../shared/domain/entities.ts";
import { humanRequestTransitions } from "../shared/domain/states.ts";

const ownerActions = [
  { status: "answered", label: "Respond" },
  { status: "completed", label: "Mark completed" },
  { status: "declined", label: "Decline" },
  { status: "deferred", label: "Defer" },
] as const;

const denialActions = [
  { status: "completed", label: "Acknowledge denial" },
  { status: "deferred", label: "Defer" },
] as const;

export function humanRequestActions(
  status: HumanRequest["status"],
  nativeDenial = false,
) {
  return (nativeDenial ? denialActions : ownerActions).filter((action) =>
    humanRequestTransitions[status].includes(action.status),
  );
}
