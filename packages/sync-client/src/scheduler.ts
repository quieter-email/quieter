type WarmTask = { key: string; priority: number; run: () => Promise<void> };

export class WarmScheduler {
  private readonly queued = new Map<string, WarmTask>();
  private readonly running = new Set<string>();
  private readonly report: (error: unknown) => void;
  private visible = true;
  private stopped = false;

  constructor(report: (error: unknown) => void) {
    this.report = report;
  }

  enqueue(task: WarmTask) {
    if (this.stopped || this.running.has(task.key)) {
      return;
    }
    const existing = this.queued.get(task.key);
    if (existing === undefined || task.priority < existing.priority) {
      this.queued.set(task.key, task);
    }
    this.pump();
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.pump();
  }
  stop() {
    this.stopped = true;
    this.queued.clear();
  }

  private pump() {
    if (this.stopped) {
      return;
    }
    const sorted = [...this.queued.values()].toSorted(
      (a, b) => a.priority - b.priority
    );
    for (const task of sorted) {
      if (this.running.size >= 3) {
        break;
      }
      if (!this.visible && task.priority > 0) {
        continue;
      }
      this.queued.delete(task.key);
      this.running.add(task.key);
      void this.execute(task);
    }
  }

  private async execute(task: WarmTask) {
    try {
      await task.run();
    } catch (error) {
      if (!this.stopped) {
        this.report(error);
      }
    } finally {
      this.running.delete(task.key);
      this.pump();
    }
  }
}
