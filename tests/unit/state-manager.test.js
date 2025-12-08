/**
 * Unit Tests for State Manager Module
 * Tests state management, subscribe/notify pattern
 * Requirements: 1.4, 5.1, 5.3
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createStateManager, StateManager } from '../../state-manager.js';

describe('StateManager', () => {
  let stateManager;

  beforeEach(() => {
    // Create fresh state manager for each test
    stateManager = createStateManager();
  });

  describe('getState', () => {
    it('should return initial state with correct structure', () => {
      const state = stateManager.getState();
      
      expect(state).toEqual({
        isAuthenticated: false,
        user: null,
        tasks: [],
        isLoading: false,
        error: null,
        pendingChanges: []
      });
    });

    it('should return immutable copy of state', () => {
      const state1 = stateManager.getState();
      const state2 = stateManager.getState();
      
      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe('setState', () => {
    it('should merge partial state correctly (Requirement 1.4)', () => {
      stateManager.setState({ isLoading: true });
      
      const state = stateManager.getState();
      expect(state.isLoading).toBe(true);
      expect(state.isAuthenticated).toBe(false);
    });

    it('should update multiple properties at once', () => {
      stateManager.setState({
        isAuthenticated: true,
        user: { id: '123', name: 'Test User' }
      });
      
      const state = stateManager.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toEqual({ id: '123', name: 'Test User' });
    });

    it('should preserve existing state when updating', () => {
      stateManager.setState({ tasks: [{ id: '1', name: 'Task 1' }] });
      stateManager.setState({ isLoading: true });
      
      const state = stateManager.getState();
      expect(state.tasks).toEqual([{ id: '1', name: 'Task 1' }]);
      expect(state.isLoading).toBe(true);
    });
  });

  describe('subscribe/notify', () => {
    it('should notify subscribers on state change (Requirement 2.1)', () => {
      const listener = vi.fn();
      stateManager.subscribe(listener);
      
      stateManager.setState({ isLoading: true });
      
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ isLoading: true }));
    });

    it('should notify multiple subscribers', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      
      stateManager.subscribe(listener1);
      stateManager.subscribe(listener2);
      
      stateManager.setState({ isAuthenticated: true });
      
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('should return unsubscribe function', () => {
      const listener = vi.fn();
      const unsubscribe = stateManager.subscribe(listener);
      
      stateManager.setState({ isLoading: true });
      expect(listener).toHaveBeenCalledTimes(1);
      
      unsubscribe();
      stateManager.setState({ isLoading: false });
      expect(listener).toHaveBeenCalledTimes(1); // Still 1, not called again
    });

    it('should track subscriber count correctly', () => {
      expect(stateManager.getSubscriberCount()).toBe(0);
      
      const unsub1 = stateManager.subscribe(() => {});
      expect(stateManager.getSubscriberCount()).toBe(1);
      
      const unsub2 = stateManager.subscribe(() => {});
      expect(stateManager.getSubscriberCount()).toBe(2);
      
      unsub1();
      expect(stateManager.getSubscriberCount()).toBe(1);
    });
  });

  describe('reset', () => {
    it('should reset to initial unauthenticated state (Requirement 5.3)', () => {
      // Set up authenticated state
      stateManager.setState({
        isAuthenticated: true,
        user: { id: '123', name: 'Test User' },
        tasks: [{ id: '1', name: 'Task 1' }],
        isLoading: false,
        error: null
      });
      
      // Reset
      stateManager.reset();
      
      const state = stateManager.getState();
      expect(state).toEqual({
        isAuthenticated: false,
        user: null,
        tasks: [],
        isLoading: false,
        error: null,
        pendingChanges: []
      });
    });

    it('should notify subscribers on reset', () => {
      const listener = vi.fn();
      stateManager.subscribe(listener);
      
      stateManager.reset();
      
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('setError', () => {
    it('should set error state and clear loading (Requirement 5.1)', () => {
      stateManager.setState({ isLoading: true });
      stateManager.setError('Network error');
      
      const state = stateManager.getState();
      expect(state.error).toBe('Network error');
      expect(state.isLoading).toBe(false);
    });

    it('should notify subscribers when error is set', () => {
      const listener = vi.fn();
      stateManager.subscribe(listener);
      
      stateManager.setError('API error');
      
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ error: 'API error' }));
    });
  });

  describe('clearError', () => {
    it('should clear error state', () => {
      stateManager.setError('Some error');
      stateManager.clearError();
      
      const state = stateManager.getState();
      expect(state.error).toBeNull();
    });
  });

  describe('singleton StateManager', () => {
    it('should export a default singleton instance', () => {
      expect(StateManager).toBeDefined();
      expect(typeof StateManager.getState).toBe('function');
      expect(typeof StateManager.setState).toBe('function');
      expect(typeof StateManager.subscribe).toBe('function');
    });
  });
});
