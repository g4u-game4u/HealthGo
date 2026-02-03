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
    this.queue.push({
      ...update,
      timestamp: Date.now(),
      id: `${update.taskId}-${Date.now()}`
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
   */
  async processQueue() {
    // If already processing, skip
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    // Process items one by one
    while (this.queue.length > 0) {
      const update = this.queue[0];

      try {
        if (update.action === 'increment') {
          // Use specific task from queue payload
          await ApiClient.updateTaskStatus(update.task, 'DONE');
        } else if (update.action === 'decrement') {
          // Use specific task from queue payload
          await ApiClient.updateTaskStatus(update.task, 'PENDING');
        }

        // Remove from queue on success
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

        // For other errors, keep item in queue and retry later
        this.isProcessing = false;
        break;
      }
    }

    this.isProcessing = false;
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
   * Sync with backend - only if queue is empty
   * @returns {Promise<Array>} Updated tasks with conflict markers
   */
  async syncWithBackend() {
    // Don't sync if there are pending changes
    if (this.queue.length > 0) {
      console.log('Skipping sync - pending changes in queue');
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
