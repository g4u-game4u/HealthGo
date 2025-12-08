/**
 * Property-Based Tests for State Manager Module
 * Tests universal properties that should hold across all inputs
 * Requirements: 5.1, 5.3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { createStateManager } from '../../state-manager.js';

describe('StateManager Property Tests', () => {
  let stateManager;

  beforeEach(() => {
    stateManager = createStateManager();
  });

  // **Feature: factory-task-tracker, Property 11: API errors set error state**
  describe('Property 11: API errors set error state', () => {
    it('*For any* API request that fails, the state manager SHALL set error to a non-null message and isLoading to false', () => {
      fc.assert(
        fc.property(
          // Generate random non-empty error messages
          fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
          // Generate random initial isLoading state
          fc.boolean(),
          (errorMessage, initialLoading) => {
            // Reset state manager for each test
            const sm = createStateManager();
            
            // Set initial loading state
            sm.setState({ isLoading: initialLoading });
            
            // Simulate API error by calling setError
            sm.setError(errorMessage);
            
            const state = sm.getState();
            
            // Property: error SHALL be non-null
            expect(state.error).not.toBeNull();
            expect(state.error).toBe(errorMessage);
            
            // Property: isLoading SHALL be false
            expect(state.isLoading).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should set error state regardless of previous state', () => {
      fc.assert(
        fc.property(
          // Generate random error messages
          fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
          // Generate random previous state
          fc.record({
            isAuthenticated: fc.boolean(),
            user: fc.option(fc.record({ id: fc.string(), name: fc.string() }), { nil: null }),
            tasks: fc.array(fc.record({
              id: fc.string(),
              name: fc.string(),
              executionCount: fc.nat(),
              targetCount: fc.nat()
            })),
            isLoading: fc.boolean(),
            error: fc.option(fc.string(), { nil: null })
          }),
          (errorMessage, previousState) => {
            const sm = createStateManager();
            
            // Set previous state
            sm.setState(previousState);
            
            // Set error
            sm.setError(errorMessage);
            
            const state = sm.getState();
            
            // Error should be set
            expect(state.error).toBe(errorMessage);
            // Loading should be false
            expect(state.isLoading).toBe(false);
            // Other state should be preserved
            expect(state.isAuthenticated).toBe(previousState.isAuthenticated);
            expect(state.user).toEqual(previousState.user);
            expect(state.tasks).toEqual(previousState.tasks);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // **Feature: factory-task-tracker, Property 12: Logout resets to unauthenticated state**
  describe('Property 12: Logout resets to unauthenticated state', () => {
    it('*For any* logout action or expired session, the state SHALL reset isAuthenticated to false and user to null', () => {
      fc.assert(
        fc.property(
          // Generate random authenticated state before logout
          fc.record({
            isAuthenticated: fc.constant(true), // Must be authenticated before logout
            user: fc.record({ id: fc.string(), name: fc.string(), email: fc.string() }),
            tasks: fc.array(fc.record({
              id: fc.string(),
              name: fc.string(),
              executionCount: fc.nat(),
              targetCount: fc.nat(),
              isCompleted: fc.boolean()
            })),
            isLoading: fc.boolean(),
            error: fc.option(fc.string(), { nil: null })
          }),
          (authenticatedState) => {
            const sm = createStateManager();
            
            // Set authenticated state
            sm.setState(authenticatedState);
            
            // Verify we're authenticated
            expect(sm.getState().isAuthenticated).toBe(true);
            expect(sm.getState().user).not.toBeNull();
            
            // Perform logout (reset)
            sm.reset();
            
            const state = sm.getState();
            
            // Property: isAuthenticated SHALL be false
            expect(state.isAuthenticated).toBe(false);
            
            // Property: user SHALL be null
            expect(state.user).toBeNull();
            
            // Additional: tasks should be cleared
            expect(state.tasks).toEqual([]);
            
            // Additional: error should be cleared
            expect(state.error).toBeNull();
            
            // Additional: isLoading should be false
            expect(state.isLoading).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reset to exact initial state regardless of previous state', () => {
      const initialState = {
        isAuthenticated: false,
        user: null,
        tasks: [],
        isLoading: false,
        error: null,
        pendingChanges: []
      };

      fc.assert(
        fc.property(
          // Generate any random state
          fc.record({
            isAuthenticated: fc.boolean(),
            user: fc.option(fc.record({ id: fc.string(), name: fc.string() }), { nil: null }),
            tasks: fc.array(fc.record({
              id: fc.string(),
              name: fc.string(),
              executionCount: fc.nat(),
              targetCount: fc.nat()
            })),
            isLoading: fc.boolean(),
            error: fc.option(fc.string(), { nil: null })
          }),
          (randomState) => {
            const sm = createStateManager();
            
            // Set random state
            sm.setState(randomState);
            
            // Reset
            sm.reset();
            
            // Should match initial state exactly
            expect(sm.getState()).toEqual(initialState);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
