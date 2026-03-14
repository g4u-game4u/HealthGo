/**
 * Sync Queue Unit Tests
 * Tests for the background sync queue functionality
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SyncQueue } from '../../sync-queue.js';
import { StateManager } from '../../state-manager.js';
import { ApiClient } from '../../api-client.js';

describe('SyncQueue', () => {
  beforeEach(() => {
    // Clear queue before each test
    SyncQueue.clearQueue();
    SyncQueue.stop();
    SyncQueue.isProcessing = false;
    
    // Reset state
    StateManager.reset();
    
    // Mock API methods
    vi.spyOn(ApiClient, 'markOldestPendingAsDone').mockResolvedValue({});
    vi.spyOn(ApiClient, 'reopenNewestDoneTask').mockResolvedValue({});
    vi.spyOn(ApiClient, 'getTasks').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    SyncQueue.stop();
    SyncQueue.clearQueue();
    SyncQueue.isProcessing = false;
  });

  describe('enqueue', () => {
    it('should add update to queue and trigger processing', () => {
      // Prevent auto-processing so we can inspect queue state
      SyncQueue.isProcessing = true;

      const task = { id: 'task-1', name: 'Test', tasks: [] };
      const update = {
        taskId: 'task-1',
        action: 'increment',
        task,
        originalTask: task
      };

      SyncQueue.enqueue(update);

      const status = SyncQueue.getStatus();
      // Queue has 1 action + 1 refresh = 2 items
      expect(status.queueLength).toBe(2);
      // The first item should be the action
      expect(SyncQueue.queue[0].type).toBe('action');
      expect(SyncQueue.queue[0].taskId).toBe('task-1');
    });

    it('should update state with pending changes', () => {
      // Prevent auto-processing
      SyncQueue.isProcessing = true;

      const task = { id: 'task-1', name: 'Test', tasks: [] };
      const update = {
        taskId: 'task-1',
        action: 'increment',
        task,
        originalTask: task
      };

      SyncQueue.enqueue(update);

      const state = StateManager.getState();
      expect(state.pendingChanges).toHaveLength(1);
    });
  });

  describe('processQueue', () => {
    it('should process increment action', async () => {
      const task = { id: 'task-1', name: 'Test', tasks: [{ id: 'sub-1', status: 'PENDING', created_at: new Date().toISOString() }] };
      
      // Manually add to queue to control the flow
      SyncQueue.queue.push({
        taskId: 'task-1',
        action: 'increment',
        task,
        originalTask: task,
        type: 'action',
        timestamp: Date.now(),
        id: 'test-1',
        retryCount: 0,
        maxRetries: 5
      });

      await SyncQueue.processQueue();

      expect(ApiClient.markOldestPendingAsDone).toHaveBeenCalledWith(task);
    });

    it('should process decrement action', async () => {
      const task = { id: 'task-1', name: 'Test', tasks: [{ id: 'sub-1', status: 'DONE', created_at: new Date().toISOString() }] };
      
      SyncQueue.queue.push({
        taskId: 'task-1',
        action: 'decrement',
        task,
        originalTask: task,
        type: 'action',
        timestamp: Date.now(),
        id: 'test-2',
        retryCount: 0,
        maxRetries: 5
      });

      await SyncQueue.processQueue();

      expect(ApiClient.reopenNewestDoneTask).toHaveBeenCalledWith(task);
    });

    it('should remove item from queue on success', async () => {
      const task = { id: 'task-1', name: 'Test', tasks: [{ id: 'sub-1', status: 'PENDING', created_at: new Date().toISOString() }] };
      
      SyncQueue.queue.push({
        taskId: 'task-1',
        action: 'increment',
        task,
        originalTask: task,
        type: 'action',
        timestamp: Date.now(),
        id: 'test-3',
        retryCount: 0,
        maxRetries: 5
      });

      await SyncQueue.processQueue();

      const status = SyncQueue.getStatus();
      expect(status.queueLength).toBe(0);
    });

    it('should skip items without originalTask', async () => {
      SyncQueue.queue.push({
        taskId: 'task-1',
        action: 'increment',
        task: { id: 'task-1' },
        // no originalTask
        type: 'action',
        timestamp: Date.now(),
        id: 'test-no-original',
        retryCount: 0,
        maxRetries: 5
      });

      await SyncQueue.processQueue();

      expect(ApiClient.markOldestPendingAsDone).not.toHaveBeenCalled();
      expect(SyncQueue.queue.length).toBe(0);
    });

    it('should clear queue on session expiry', async () => {
      ApiClient.markOldestPendingAsDone.mockRejectedValue(new Error('SESSION_EXPIRED'));
      
      const task = { id: 'task-1', name: 'Test', tasks: [] };
      
      SyncQueue.queue.push({
        taskId: 'task-1',
        action: 'increment',
        task,
        originalTask: task,
        type: 'action',
        timestamp: Date.now(),
        id: 'test-session',
        retryCount: 0,
        maxRetries: 5
      });

      try {
        await SyncQueue.processQueue();
      } catch (error) {
        expect(error.message).toBe('SESSION_EXPIRED');
      }

      const status = SyncQueue.getStatus();
      expect(status.queueLength).toBe(0);
    });
  });

  describe('syncWithBackend', () => {
    it('should skip sync if queue has pending changes', async () => {
      // Prevent auto-processing
      SyncQueue.isProcessing = true;
      SyncQueue.queue.push({
        taskId: 'task-1',
        action: 'increment',
        type: 'action',
        id: 'test-pending'
      });
      SyncQueue.isProcessing = false;

      const result = await SyncQueue.syncWithBackend();

      expect(result).toBeNull();
      expect(ApiClient.getTasks).not.toHaveBeenCalled();
    });

    it('should fetch tasks if queue is empty', async () => {
      const mockTasks = [{ id: 'task-1', executionCount: 5 }];
      ApiClient.getTasks.mockResolvedValue(mockTasks);

      StateManager.setState({ tasks: [] });

      const result = await SyncQueue.syncWithBackend();

      expect(ApiClient.getTasks).toHaveBeenCalled();
      expect(result).toEqual(mockTasks);
    });

    it('should mark conflicts when counts differ', async () => {
      const localTasks = [{ id: 'task-1', executionCount: 3 }];
      const backendTasks = [{ id: 'task-1', executionCount: 5 }];
      
      ApiClient.getTasks.mockResolvedValue(backendTasks);
      StateManager.setState({ tasks: localTasks });

      const result = await SyncQueue.syncWithBackend();

      expect(result[0].hasConflict).toBe(true);
      expect(result[0].executionCount).toBe(5); // Backend wins
    });

    it('should not mark conflicts when counts match', async () => {
      const localTasks = [{ id: 'task-1', executionCount: 5 }];
      const backendTasks = [{ id: 'task-1', executionCount: 5 }];
      
      ApiClient.getTasks.mockResolvedValue(backendTasks);
      StateManager.setState({ tasks: localTasks });

      const result = await SyncQueue.syncWithBackend();

      expect(result[0].hasConflict).toBeUndefined();
    });
  });

  describe('clearConflict', () => {
    it('should remove conflict marker from task', () => {
      const tasks = [
        { id: 'task-1', hasConflict: true, conflictTimestamp: Date.now() },
        { id: 'task-2', hasConflict: false }
      ];
      
      StateManager.setState({ tasks });

      SyncQueue.clearConflict('task-1');

      const state = StateManager.getState();
      expect(state.tasks[0].hasConflict).toBe(false);
      expect(state.tasks[0].conflictTimestamp).toBeNull();
    });
  });
});
