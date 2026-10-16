import { z } from "zod";

export async function readApi(
  path: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(`/api/${path}`, signal ? { signal } : {});
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}
const pending = new Map<string, string>();
export async function writeApi(
  path: string,
  input: unknown,
  method = "POST",
): Promise<unknown> {
  const signature = `${method}:${path}:${JSON.stringify(input)}`;
  const key = pending.get(signature) ?? crypto.randomUUID();
  pending.set(signature, key);
  const { token } = z
    .strictObject({ token: z.string() })
    .parse(await readApi("local-session"));
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Local-Token": token,
        "Idempotency-Key": key,
      },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error(
      "Request outcome is unconfirmed. Retry this action to reuse the same idempotency key.",
    );
  }
  const value: unknown = await response.json();
  if (!response.ok) {
    if (response.status < 500) pending.delete(signature);
    const error = z.object({ error: z.string() }).safeParse(value);
    throw new Error(
      error.success ? error.data.error : `Request failed (${response.status})`,
    );
  }
  pending.delete(signature);
  return value;
}
