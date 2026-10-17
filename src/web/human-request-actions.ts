import type { HumanRequest } from "../shared/domain/entities.ts";
import { humanRequestTransitions } from "../shared/domain/states.ts";

const ownerActions = [
  { status: "answered", label: "Respond" },
  { status: "completed", label: "Mark completed" },
  { status: "declined", label: "Decline" },
  { status: "deferred", label: "Defer" },
] as const;

export function humanRequestActions(status: HumanRequest["status"]) {
  return ownerActions.filter((action) =>
    humanRequestTransitions[status].includes(action.status),
  );
}
