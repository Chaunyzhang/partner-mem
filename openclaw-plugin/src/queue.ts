export class SessionSerialQueue {
  private readonly tails = new Map<string, Promise<void>>();

  enqueue(sessionKey: string, task: () => Promise<void>): void {
    const previous = this.tails.get(sessionKey) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(task)
      .catch(() => undefined)
      .finally(() => {
        if (this.tails.get(sessionKey) === next) {
          this.tails.delete(sessionKey);
        }
      });
    this.tails.set(sessionKey, next);
  }

  async flush(sessionKey?: string): Promise<void> {
    if (sessionKey) {
      await (this.tails.get(sessionKey) ?? Promise.resolve());
      return;
    }
    await Promise.all([...this.tails.values()]);
  }
}
