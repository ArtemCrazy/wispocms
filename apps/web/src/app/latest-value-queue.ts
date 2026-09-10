export class LatestValueQueue<T> {
  private pending: T | undefined;
  private running: Promise<void> | null = null;
  private readonly worker: (value: T) => Promise<void>;

  constructor(worker: (value: T) => Promise<void>) {
    this.worker = worker;
  }

  enqueue(value: T) {
    this.pending = value;
    if (!this.running) this.start();
  }

  async idle() {
    while (this.running) await this.running;
  }

  private start() {
    this.running = this.drain().finally(() => {
      this.running = null;
      if (this.pending !== undefined) this.start();
    });
  }

  private async drain() {
    while (this.pending !== undefined) {
      const value = this.pending;
      this.pending = undefined;
      await this.worker(value);
    }
  }
}
