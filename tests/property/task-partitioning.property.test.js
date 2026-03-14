/**
 * Property-Based Tests for Task List Partitioning
 * Tests universal properties for partitioning tasks by status
 * Requirements: 3.2, 3.3, 3.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { partitionTasks } from '../../task-utils.js';

// Generator for a task with a random status from the valid set
const statusArbitrary = fc.constantFrom('PENDING', 'DOING', 'DONE', 'DELIVERED');

const taskArbitrary = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  status: statusArbitrary,
  comments: fc.array(fc.string(), { minLength: 0, maxLength: 3 })
});

const taskArrayArbitrary = fc.array(taskArbitrary, { minLength: 0, maxLength: 30 });

// Feature: app-enhancements, Property 4: Task list partitioning by status
describe('Task Partitioning Property Tests', () => {
  describe('Property 4: Task list partitioning by status', () => {
    // **Validates: Requirements 3.2, 3.3, 3.4**

    it('every PENDING or DOING task appears in the todo array', () => {
      fc.assert(
        fc.property(taskArrayArbitrary, (tasks) => {
          const { todo } = partitionTasks(tasks);
          const pendingOrDoing = tasks.filter(t => t.status === 'PENDING' || t.status === 'DOING');
          expect(todo).toEqual(pendingOrDoing);
        }),
        { numRuns: 100 }
      );
    });

    it('every DONE task appears in the completed array', () => {
      fc.assert(
        fc.property(taskArrayArbitrary, (tasks) => {
          const { completed } = partitionTasks(tasks);
          const doneTasks = tasks.filter(t => t.status === 'DONE');
          expect(completed).toEqual(doneTasks);
        }),
        { numRuns: 100 }
      );
    });

    it('no DELIVERED task appears in either array', () => {
      fc.assert(
        fc.property(taskArrayArbitrary, (tasks) => {
          const { todo, completed } = partitionTasks(tasks);
          const allPartitioned = [...todo, ...completed];
          for (const task of allPartitioned) {
            expect(task.status).not.toBe('DELIVERED');
          }
        }),
        { numRuns: 100 }
      );
    });

    it('union of todo + completed + excluded DELIVERED accounts for all input tasks', () => {
      fc.assert(
        fc.property(taskArrayArbitrary, (tasks) => {
          const { todo, completed } = partitionTasks(tasks);
          const deliveredCount = tasks.filter(t => t.status === 'DELIVERED').length;
          expect(todo.length + completed.length + deliveredCount).toBe(tasks.length);
        }),
        { numRuns: 100 }
      );
    });
  });
});
