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
  hasRefreshQueued: false, // Track if refresh is already queued
  REFRESH_DELAY_MS: 500, // Delay before refresh to let backend catch up

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
    // Remove any existing refresh requests from queue
    this.queue = this.queue.filter(item => item.type !== 'refresh');
    this.hasRefreshQueued = false;

    // Always add to queue - allow multiple rapid clicks on same task
    this.queue.push({
      ...update,
      type: 'action', // Mark as action request
      timestamp: Date.now(),
      id: `${update.taskId}-${update.action}-${Date.now()}-${Math.random()}`,
      retryCount: 0, // Track retry attempts
      maxRetries: 5 // Maximum retry attempts before giving up
    });

    // Add refresh request at the end
    this.queueRefresh();

    // Update state to reflect pending changes (excluding refresh requests)
    const state = StateManager.getState();
    StateManager.setState({
      pendingChanges: this.queue.filter(item => item.type === 'action')
    });

    // Process queue immediately (non-blocking)
    this.processQueue();
  },

  /**
   * Queue a refresh request at the end of the queue
   * Only one refresh request is queued at a time
   */
  queueRefresh() {
    if (this.hasRefreshQueued) {
      return; // Already have a refresh queued
    }

    this.hasRefreshQueued = true;
    this.queue.push({
      type: 'refresh',
      id: `refresh-${Date.now()}`,
      timestamp: Date.now()
    });
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
      
      // Handle refresh requests
      if (update.type === 'refresh') {
        this.queue.shift();
        this.hasRefreshQueued = false;
        
        // Wait 500ms to let backend catch up
        await new Promise(resolve => setTimeout(resolve, this.REFRESH_DELAY_MS));
        
        // Fetch fresh data from backend
        try {
          const tasks = await ApiClient.getTasks();
          StateManager.setState({ 
            tasks, 
            error: null,
            pendingChanges: this.queue.filter(item => item.type === 'action')
          });
        } catch (error) {
          console.error('Failed to refresh tasks:', error);
          if (error.message === 'SESSION_EXPIRED') {
            this.clearQueue();
            this.isProcessing = false;
            throw error;
          }
          // Continue processing even if refresh fails
        }
        continue;
      }
      
      // Handle action requests
      try {
        // Use the original task state from the queue (before optimistic updates)
        // This ensures we have the real backend state with PENDING tasks
        const taskToProcess = update.originalTask;
        
        if (!taskToProcess) {
          console.error('No original task in queue update:', update.taskId);
          this.queue.shift();
          continue;
        }
        
        if (update.action === 'increment') {
          await ApiClient.markOldestPendingAsDone(taskToProcess);
        } else if (update.action === 'decrement') {
          await ApiClient.reopenNewestDoneTask(taskToProcess);
        }
        
        // Success - remove from queue
        this.queue.shift();
        
        // Update state with remaining pending changes
        StateManager.setState({
          pendingChanges: this.queue.filter(item => item.type === 'action')
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
          
          // Insert before any refresh requests
          const refreshIndex = this.queue.findIndex(item => item.type === 'refresh');
          if (refreshIndex >= 0) {
            this.queue.splice(refreshIndex, 0, update);
          } else {
            this.queue.push(update);
          }
          
          // Update state
          StateManager.setState({
            pendingChanges: this.queue.filter(item => item.type === 'action')
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
            pendingChanges: this.queue.filter(item => item.type === 'action'),
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
    this.hasRefreshQueued = false;
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
