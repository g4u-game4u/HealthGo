/**
 * Sync Queue Module
 * Manages background synchronization of task updates with optimistic UI
 */

import { ApiClient } from './api-client.js';
import { StateManager } from './state-manager.js';

export const SyncQueue = {
  queue: [],
  isProcessing: false,
  syncInterval: null,
  SYNC_INTERVAL_MS: 60000, // 1 minute
  processingPromise: null,

  /**
   * Initialize the sync queue and start periodic sync
   */
  init() {
    this.startPeriodicSync();
  },

  /**
   * Add a task update to the queue and apply optimistically
   * @param {Object} update - { taskId, action: 'increment'|'decrement', task }
   */
  enqueue(update) {
    // Always add to queue - allow multiple rapid clicks on same task
    this.queue.push({
      ...update,
      timestamp: Date.now(),
      id: `${update.taskId}-${update.action}-${Date.now()}-${Math.random()}`,
      retryCount: 0, // Track retry attempts
      maxRetries: 5 // Maximum retry attempts before giving up
    });

    // Update state to reflect pending changes
    const state = StateManager.getState();
    StateManager.setState({
      pendingChanges: [...this.queue]
    });

    // Process queue immediately (non-blocking)
    this.processQueue();
  },

  /**
   * Process all queued updates in background
   * Processes items sequentially to avoid overwhelming the backend
   */
  async processQueue() {
    // If already processing, skip (only one processing loop at a time)
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    // Process items one by one sequentially
    while (this.queue.length > 0) {
      const update = this.queue[0];
      
      try {
        if (update.action === 'increment') {
          await ApiClient.markOldestPendingAsDone(update.task);
        } else if (update.action === 'decrement') {
          await ApiClient.reopenNewestDoneTask(update.task);
        }
        
        // Success - remove from queue
        this.queue.shift();
        
        // Update state with remaining pending changes
        StateManager.setState({
          pendingChanges: [...this.queue]
        });
      } catch (error) {
        console.error('Failed to process queue item:', error);

        // If session expired, clear queue and stop
        if (error.message === 'SESSION_EXPIRED') {
          this.clearQueue();
          this.isProcessing = false;
          throw error;
        }

        // For other errors, check retry count
        update.retryCount = (update.retryCount || 0) + 1;
        
        if (update.retryCount < update.maxRetries) {
          // Retry: remove from front and add to end with updated retry count
          console.log(`Retrying queue item (attempt ${update.retryCount}/${update.maxRetries}):`, update.taskId);
          this.queue.shift();
          this.queue.push(update);
          
          // Update state
          StateManager.setState({
            pendingChanges: [...this.queue]
          });
          
          // Wait before processing next item (exponential backoff)
          // This gives time for transient errors to resolve
          const delayMs = Math.min(1000 * Math.pow(2, update.retryCount - 1), 10000);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        } else {
          // Max retries reached - revert optimistic update and show error
          console.error(`Max retries reached for queue item:`, update.taskId);
          this.queue.shift();
          
          // Revert the optimistic update
          this.revertOptimisticUpdate(update);
          
          // Update state
          StateManager.setState({
            pendingChanges: [...this.queue],
            error: `Failed to ${update.action === 'increment' ? 'complete' : 'reopen'} task after ${update.maxRetries} attempts. Please try again.`
          });
        }
      }
    }

    this.isProcessing = false;
  },

  /**
   * Revert an optimistic update when max retries are reached
   * @param {Object} update - The failed update
   */
  revertOptimisticUpdate(update) {
    const state = StateManager.getState();
    const taskGroup = state.tasks.find(t => t.id === update.taskId);
    
    if (!taskGroup) return;
    
    // Revert the count change
    const revertedCount = update.action === 'increment' 
      ? Math.max(taskGroup.executionCount - 1, 0)
      : Math.min(taskGroup.executionCount + 1, taskGroup.targetCount);
    
    // Find the sub-task that was optimistically changed
    let revertedSubTasks;
    if (update.action === 'increment') {
      // Find the most recently marked DONE task and revert it to PENDING
      const doneTasks = taskGroup.tasks
        .filter(t => t.status === 'DONE')
        .sort((a, b) => new Date(b.finished_at || b.created_at) - new Date(a.finished_at || a.created_at));
      
      if (doneTasks.length > 0) {
        const taskToRevert = doneTasks[0];
        revertedSubTasks = taskGroup.tasks.map(subTask =>
          subTask.id === taskToRevert.id
            ? { ...subTask, status: 'PENDING', finished_at: null }
            : subTask
        );
      } else {
        revertedSubTasks = taskGroup.tasks;
      }
    } else {
      // Find the most recently marked PENDING task and revert it to DONE
      const pendingTasks = taskGroup.tasks
        .filter(t => t.status === 'PENDING')
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      
      if (pendingTasks.length > 0) {
        const taskToRevert = pendingTasks[0];
        revertedSubTasks = taskGroup.tasks.map(subTask =>
          subTask.id === taskToRevert.id
            ? { ...subTask, status: 'DONE', finished_at: new Date().toISOString() }
            : subTask
        );
      } else {
        revertedSubTasks = taskGroup.tasks;
      }
    }
    
    // Update the task group with reverted state
    const updatedTasks = state.tasks.map(t => {
      if (t.id === update.taskId) {
        return {
          ...t,
          tasks: revertedSubTasks,
          executionCount: revertedCount,
          isCompleted: revertedCount === t.targetCount && t.targetCount > 0,
          hasConflict: false
        };
      }
      return t;
    });
    
    StateManager.setState({ tasks: updatedTasks });
  },

  /**
   * Start periodic sync to reconcile with backend
   */
  startPeriodicSync() {
    // Clear any existing interval
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(async () => {
      await this.syncWithBackend();
    }, this.SYNC_INTERVAL_MS);
  },

  /**
   * Sync with backend - only if queue is empty and not processing
   * @returns {Promise<Array>} Updated tasks with conflict markers
   */
  async syncWithBackend() {
    // Don't sync if there are pending changes or currently processing
    if (this.queue.length > 0 || this.isProcessing) {
      console.log('Skipping sync - pending changes in queue or processing');
      return null;
    }

    try {
      const state = StateManager.getState();
      const currentTasks = state.tasks;

      // Fetch fresh data from backend
      const backendTasks = await ApiClient.getTasks();

      // Compare and mark conflicts
      const tasksWithConflicts = this.detectConflicts(currentTasks, backendTasks);

      // Update state with backend data
      StateManager.setState({
        tasks: tasksWithConflicts,
        error: null
      });

      return tasksWithConflicts;
    } catch (error) {
      console.error('Sync failed:', error);

      if (error.message === 'SESSION_EXPIRED') {
        throw error;
      }

      return null;
    }
  },

  /**
   * Detect conflicts between local and backend state
   * @param {Array} localTasks - Current local tasks
   * @param {Array} backendTasks - Fresh tasks from backend
   * @returns {Array} Tasks with conflict markers
   */
  detectConflicts(localTasks, backendTasks) {
    return backendTasks.map(backendTask => {
      const localTask = localTasks.find(t => t.id === backendTask.id);

      // If task exists locally and counts differ, mark as conflict
      if (localTask && localTask.executionCount !== backendTask.executionCount) {
        return {
          ...backendTask,
          hasConflict: true,
          conflictTimestamp: Date.now()
        };
      }

      return backendTask;
    });
  },

  /**
   * Clear conflict marker from a task
   * @param {string} taskId - Task ID
   */
  clearConflict(taskId) {
    const state = StateManager.getState();
    const updatedTasks = state.tasks.map(task =>
      task.id === taskId ? { ...task, hasConflict: false, conflictTimestamp: null } : task
    );
    StateManager.setState({ tasks: updatedTasks });
  },

  /**
   * Auto-clear conflicts after 3 seconds
   * @param {string} taskId - Task ID
   */
  autoClearConflict(taskId) {
    setTimeout(() => {
      this.clearConflict(taskId);
    }, 3000);
  },

  /**
   * Clear the entire queue
   */
  clearQueue() {
    this.queue = [];
    StateManager.setState({ pendingChanges: [] });
  },

  /**
   * Stop periodic sync
   */
  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  },

  /**
   * Get queue status
   * @returns {Object} { queueLength, isProcessing }
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing
    };
  }
};
