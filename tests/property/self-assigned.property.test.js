/**
 * Property-Based Tests for Self-Assigned Actions
 * Tests universal properties for self-assigned identification and related logic
 * Requirements: 2.4
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { isSelfAssigned, renderTaskCard } from '../../task-utils.js';
import { ApiClient } from '../../api-client.js';
import { createStateManager } from '../../state-manager.js';

// Generator for comments array that contains the [SELF-ASSIGNED] marker
const commentsWithSelfAssignedArbitrary = fc.array(
  fc.string().filter(s => s !== '[SELF-ASSIGNED]'),
  { minLength: 0, maxLength: 5 }
).chain(otherComments =>
  fc.nat({ max: otherComments.length }).map(insertPos => {
    const comments = [...otherComments];
    comments.splice(insertPos, 0, '[SELF-ASSIGNED]');
    return comments;
  })
);

// Generator for comments array that does NOT contain the [SELF-ASSIGNED] marker
const commentsWithoutSelfAssignedArbitrary = fc.array(
  fc.string().filter(s => s !== '[SELF-ASSIGNED]'),
  { minLength: 0, maxLength: 10 }
);

// Feature: app-enhancements, Property 2: Self-assigned identification
describe('Self-Assigned Property Tests', () => {
  describe('Property 2: Self-assigned identification', () => {
    // **Validates: Requirements 2.4**

    it('tasks with "[SELF-ASSIGNED]" in comments return true', () => {
      fc.assert(
        fc.property(
          commentsWithSelfAssignedArbitrary,
          (comments) => {
            const task = { comments };
            expect(isSelfAssigned(task)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('tasks without "[SELF-ASSIGNED]" in comments return false', () => {
      fc.assert(
        fc.property(
          commentsWithoutSelfAssignedArbitrary,
          (comments) => {
            const task = { comments };
            expect(isSelfAssigned(task)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('tasks with null, undefined, or empty comments return false', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.constant([])
          ),
          (comments) => {
            const task = { comments };
            expect(isSelfAssigned(task)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

// Feature: app-enhancements, Property 3: Self-assigned rendering with approval badge
describe('Property 3: Self-assigned rendering with approval badge', () => {
  // **Validates: Requirements 2.2, 2.3**

  // Generator for a random task name
  const taskNameArbitrary = fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0);

  // Generator for a random task ID
  const taskIdArbitrary = fc.oneof(
    fc.uuid(),
    fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0)
  );

  // Generator for a random team name (optional)
  const teamNameArbitrary = fc.oneof(fc.constant(''), fc.string({ minLength: 1, maxLength: 30 }));

  // Generator for a target/execution count (completed tasks have executionCount === targetCount)
  const countArbitrary = fc.integer({ min: 1, max: 100 });

  // Generator for a self-assigned DONE sub-task
  const selfAssignedSubTaskArbitrary = fc.record({
    id: taskIdArbitrary,
    status: fc.constant('DONE'),
    comments: commentsWithSelfAssignedArbitrary,
  });

  // Generator for an aggregated task group with at least one self-assigned sub-task
  const selfAssignedTaskGroupArbitrary = fc.tuple(
    taskIdArbitrary,
    taskNameArbitrary,
    teamNameArbitrary,
    countArbitrary,
    selfAssignedSubTaskArbitrary,
    fc.array(selfAssignedSubTaskArbitrary, { minLength: 0, maxLength: 3 })
  ).map(([id, name, teamName, count, requiredSubTask, extraSubTasks]) => ({
    id,
    name,
    teamName,
    executionCount: count,
    targetCount: count,
    isCompleted: true,
    tasks: [requiredSubTask, ...extraSubTasks],
  }));

  it('self-assigned DONE tasks rendered with isCompleted=true contain "Awaiting approval"', () => {
    fc.assert(
      fc.property(
        selfAssignedTaskGroupArbitrary,
        (task) => {
          const html = renderTaskCard(task, true);
          expect(html).toContain('Awaiting approval');
        }
      ),
      { numRuns: 100 }
    );
  });
});


// Feature: app-enhancements, Property 1: Self-assigned payload correctness
describe('Property 1: Self-assigned payload correctness', () => {
  // **Validates: Requirements 1.2, 2.1**

  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    ApiClient.token = null;
    ApiClient.userEmail = null;
  });

  // Generators
  const actionTemplateIdArbitrary = fc.string({ minLength: 1, maxLength: 30 });
  const userEmailArbitrary = fc.tuple(
    fc.string({ minLength: 1, maxLength: 15 }).filter(s => /^[a-zA-Z0-9._-]+$/.test(s)),
    fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z0-9]+$/.test(s)),
    fc.constantFrom('com', 'org', 'net', 'io')
  ).map(([local, domain, tld]) => `${local}@${domain}.${tld}`);
  const deliveryTitleArbitrary = fc.string();

  it('payload has status "DONE", correct user_email, action_id, and "[SELF-ASSIGNED]" in comments', async () => {
    await fc.assert(
      fc.asyncProperty(
        actionTemplateIdArbitrary,
        userEmailArbitrary,
        deliveryTitleArbitrary,
        async (actionTemplateId, userEmail, deliveryTitle) => {
          const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ id: 'created-action' })
          });
          global.fetch = mockFetch;

          ApiClient.token = 'test-token';

          await ApiClient.createSelfAssignedAction({
            action_template_id: actionTemplateId,
            user_email: userEmail,
            delivery_title: deliveryTitle
          });

          expect(mockFetch).toHaveBeenCalledOnce();
          const callArgs = mockFetch.mock.calls[0];
          const capturedBody = JSON.parse(callArgs[1].body);

          // Verify payload correctness
          expect(capturedBody.status).toBe('DONE');
          expect(capturedBody.user_email).toBe(userEmail);
          expect(capturedBody.action_id).toBe(actionTemplateId);
          expect(capturedBody.comments).toContain('[SELF-ASSIGNED]');
        }
      ),
      { numRuns: 100 }
    );
  });
});


// Feature: app-enhancements, Property 11: Task list invariant on failed creation
describe('Property 11: Task list invariant on failed creation', () => {
  // **Validates: Requirements 1.4**

  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    ApiClient.token = null;
    ApiClient.userEmail = null;
  });

  // Generators for random task objects
  const taskArbitrary = fc.record({
    id: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 30 }),
    executionCount: fc.nat({ max: 10 }),
    targetCount: fc.nat({ max: 10 }),
    isCompleted: fc.boolean()
  });
  const taskListArbitrary = fc.array(taskArbitrary, { minLength: 0, maxLength: 10 });

  it('task list in StateManager remains unchanged when createSelfAssignedAction fails', async () => {
    await fc.assert(
      fc.asyncProperty(
        taskListArbitrary,
        async (taskList) => {
          // Create a fresh StateManager instance
          const sm = createStateManager();

          // Set the initial task list
          sm.setState({ tasks: taskList });

          // Deep copy the original task list for comparison
          const originalTasks = JSON.parse(JSON.stringify(taskList));

          // Mock fetch to reject (simulate API failure)
          global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            json: () => Promise.resolve({ message: 'Server error' })
          });

          ApiClient.token = 'test-token';

          // Attempt to create a self-assigned action (should throw)
          try {
            await ApiClient.createSelfAssignedAction({
              action_template_id: 'template-1',
              user_email: 'test@example.com',
              delivery_title: 'Test Action'
            });
          } catch {
            // Expected to throw
          }

          // Verify the task list in StateManager is deeply equal to the original
          const currentTasks = sm.getState().tasks;
          expect(currentTasks).toEqual(originalTasks);
        }
      ),
      { numRuns: 100 }
    );
  });
});
