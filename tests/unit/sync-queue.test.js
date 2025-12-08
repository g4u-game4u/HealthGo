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
  });

  describe('enqueue', () => {
    it('should add update to queue', () => {
      const update = {
        taskId: 'task-1',
        action: 'increment',
        task: { id: 'task-1', name: 'Test' }
      };

      SyncQueue.enqueue(update);

      const status = SyncQueue.getStatus();
      expect(status.queueLength).toBe(1);
    });

    it('should update state with pending changes', () => {
      const update = {
        taskId: 'task-1',
        action: 'increment',
        task: { id: 'task-1', name: 'Test' }
      };

      SyncQueue.enqueue(update);

      const state = StateManager.getState();
      expect(state.pendingChanges).toHaveLength(1);
    });
  });

  describe('processQueue', () => {
    it('should process increment action', async () => {
      const task = { id: 'task-1', name: 'Test', tasks: [] };
      
      SyncQueue.enqueue({
        taskId: 'task-1',
        action: 'increment',
        task
      });

      await SyncQueue.processQueue();

      expect(ApiClient.markOldestPendingAsDone).toHaveBeenCalledWith(task);
    });

    it('should process decrement action', async () => {
      const task = { id: 'task-1', name: 'Test', tasks: [] };
      
      SyncQueue.enqueue({
        taskId: 'task-1',
        action: 'decrement',
        task
      });

      await SyncQueue.processQueue();

      expect(ApiClient.reopenNewestDoneTask).toHaveBeenCalledWith(task);
    });

    it('should remove item from queue on success', async () => {
      const task = { id: 'task-1', name: 'Test', tasks: [] };
      
      SyncQueue.enqueue({
        taskId: 'task-1',
        action: 'increment',
        task
      });

      await SyncQueue.processQueue();

      const status = SyncQueue.getStatus();
      expect(status.queueLength).toBe(0);
    });

    it('should keep item in queue on failure', async () => {
      ApiClient.markOldestPendingAsDone.mockRejectedValue(new Error('Network error'));
      
      const task = { id: 'task-1', name: 'Test', tasks: [] };
      
      SyncQueue.enqueue({
        taskId: 'task-1',
        action: 'increment',
        task
      });

      await SyncQueue.processQueue();

      const status = SyncQueue.getStatus();
      expect(status.queueLength).toBe(1);
    });

    it('should clear queue on session expiry', async () => {
      ApiClient.markOldestPendingAsDone.mockRejectedValue(new Error('SESSION_EXPIRED'));
      
      const task = { id: 'task-1', name: 'Test', tasks: [] };
      
      SyncQueue.enqueue({
        taskId: 'task-1',
        action: 'increment',
        task
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
      SyncQueue.enqueue({
        taskId: 'task-1',
        action: 'increment',
        task: { id: 'task-1' }
      });

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
