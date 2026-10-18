import { DomainError } from "../../shared/domain/states.ts";

export class AdapterQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private wake: (() => void) | undefined;
  private ended = false;
  push(value: T): void {
    if (this.ended) throw new DomainError("CONFLICT", "Native input is closed");
    if (this.values.length >= 4096) {
      this.values.length = 0;
      throw new DomainError(
        "CONFLICT",
        "Native event queue exceeded its bounded capacity",
      );
    }
    this.values.push(value);
    this.wake?.();
  }
  close(): void {
    this.ended = true;
    this.wake?.();
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      const value = this.values.shift();
      if (value !== undefined) {
        yield value;
        continue;
      }
      if (this.ended) return;
      const waiting = Promise.withResolvers<void>();
      this.wake = waiting.resolve;
      await waiting.promise;
      this.wake = undefined;
    }
  }
}
