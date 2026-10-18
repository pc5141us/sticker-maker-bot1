import { EventEmitter } from 'events';
class TaskManager extends EventEmitter {
    activeTasks = new Map();
    queue = [];
    MAX_CONCURRENT_PACKS = 5; // عدد المهام الكبيرة المسموح بها في نفس اللحظة
    get runningCount() {
        let count = 0;
        for (const t of this.activeTasks.values()) {
            if (t.status === 'running')
                count++;
        }
        return count;
    }
    get queuedCount() {
        return this.queue.length;
    }
    getActiveTasks() {
        return Array.from(this.activeTasks.values());
    }
    registerTask(task) {
        this.activeTasks.set(task.id, task);
        this.emit('taskAdded', task);
    }
    updateTaskProgress(taskId, progressText) {
        const t = this.activeTasks.get(taskId);
        if (t) {
            t.progressText = progressText;
            this.emit('taskUpdated', t);
        }
    }
    completeTask(taskId) {
        this.activeTasks.delete(taskId);
        this.emit('taskCompleted', taskId);
        this.processNextInQueue();
    }
    /**
     * تشغيل المهمة فوراً إذا كان هناك مقعد متاح، أو وضعها في قائمة الانتظار
     */
    async enqueue(taskId, userId, userName, packName, taskFn, onQueued) {
        const taskInfo = {
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
            }
            catch (err) {
                console.error(`❌ خطأ في المهمة ${taskId}:`, err);
            }
            finally {
                this.completeTask(taskId);
            }
        };
        // في بيئة Vercel Serverless لا يمكن استخدام setImmediate لأن السيرفر يتجمد فور الرد
        if (process.env.VERCEL) {
            return await runTask();
        }
        if (this.runningCount < this.MAX_CONCURRENT_PACKS) {
            // تشغيل فوري في الخلفية بالتوازي دون انتظار
            setImmediate(runTask);
        }
        else {
            // إدخال في طابور الانتظار
            this.registerTask(taskInfo);
            this.queue.push(runTask);
            if (onQueued) {
                try {
                    onQueued(this.queue.length);
                }
                catch (_) { }
            }
        }
    }
    processNextInQueue() {
        if (this.queue.length > 0 && this.runningCount < this.MAX_CONCURRENT_PACKS) {
            const nextFn = this.queue.shift();
            if (nextFn) {
                setImmediate(nextFn);
            }
        }
    }
}
export const taskManager = new TaskManager();
