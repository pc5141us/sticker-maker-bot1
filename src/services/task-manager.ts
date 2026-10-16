import { EventEmitter } from 'events';

export interface ActiveTask {
  id: string;
  userId: number;
  userName: string;
  packName: string;
  startedAt: Date;
  status: 'running' | 'queued';
  progressText?: string;
}

class TaskManager extends EventEmitter {
  private activeTasks: Map<string, ActiveTask> = new Map();
  private queue: Array<() => Promise<void>> = [];
  public readonly MAX_CONCURRENT_PACKS = 5; // عدد المهام الكبيرة المسموح بها في نفس اللحظة

  public get runningCount(): number {
    let count = 0;
    for (const t of this.activeTasks.values()) {
      if (t.status === 'running') count++;
    }
    return count;
  }

  public get queuedCount(): number {
    return this.queue.length;
  }

  public getActiveTasks(): ActiveTask[] {
    return Array.from(this.activeTasks.values());
  }

  public registerTask(task: ActiveTask) {
    this.activeTasks.set(task.id, task);
    this.emit('taskAdded', task);
  }

  public updateTaskProgress(taskId: string, progressText: string) {
    const t = this.activeTasks.get(taskId);
    if (t) {
      t.progressText = progressText;
      this.emit('taskUpdated', t);
    }
  }

  public completeTask(taskId: string) {
    this.activeTasks.delete(taskId);
    this.emit('taskCompleted', taskId);
    this.processNextInQueue();
  }

  /**
   * تشغيل المهمة فوراً إذا كان هناك مقعد متاح، أو وضعها في قائمة الانتظار
   */
  public enqueue(
    taskId: string,
    userId: number,
    userName: string,
    packName: string,
    taskFn: () => Promise<void>,
    onQueued?: (queuePosition: number) => Promise<void> | void
  ) {
    const taskInfo: ActiveTask = {
      id: taskId,
      userId,
      userName,
      packName,
      startedAt: new Date(),
      status: this.runningCount < this.MAX_CONCURRENT_PACKS ? 'running' : 'queued'
    };

    const runTask = async () => {
      taskInfo.status = 'running';
      this.registerTask(taskInfo);
      try {
        await taskFn();
      } catch (err) {
        console.error(`❌ خطأ في المهمة ${taskId}:`, err);
      } finally {
        this.completeTask(taskId);
      }
    };

    if (this.runningCount < this.MAX_CONCURRENT_PACKS) {
      // تشغيل فوري في الخلفية بالتوازي دون انتظار
      setImmediate(runTask);
    } else {
      // إدخال في طابور الانتظار
      this.registerTask(taskInfo);
      this.queue.push(runTask);
      if (onQueued) {
        try {
          onQueued(this.queue.length);
        } catch (_) {}
      }
    }
  }

  private processNextInQueue() {
    if (this.queue.length > 0 && this.runningCount < this.MAX_CONCURRENT_PACKS) {
      const nextFn = this.queue.shift();
      if (nextFn) {
        setImmediate(nextFn);
      }
    }
  }
}

export const taskManager = new TaskManager();
