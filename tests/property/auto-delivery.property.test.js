/**
 * Property-Based Tests for Auto-Delivery Module
 * Tests universal properties for deliverable action filtering
 * Requirements: 4.1, 4.7
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { getDeliverableActions, executeDeliveries, computeDelayToNextBRT18, formatDeliveryErrorMessage } from '../../auto-delivery.js';
import { ApiClient } from '../../api-client.js';

// Fixed fake time: 2024-06-15T12:00:00Z = 2024-06-15 09:00 BRT
const FAKE_NOW = new Date('2024-06-15T12:00:00Z');

// Dates relative to the fake time in BRT
const TODAY_BRT_ISO = '2024-06-15T15:00:00Z';     // 2024-06-15 12:00 BRT (today)
const YESTERDAY_BRT_ISO = '2024-06-14T10:00:00Z';  // 2024-06-14 07:00 BRT (yesterday)
const TOMORROW_BRT_ISO = '2024-06-16T10:00:00Z';   // 2024-06-16 07:00 BRT (tomorrow)

// Generators
const statusArbitrary = fc.constantFrom('PENDING', 'DOING', 'DONE', 'DELIVERED');

const finishedAtArbitrary = fc.constantFrom(
  TODAY_BRT_ISO,
  YESTERDAY_BRT_ISO,
  TOMORROW_BRT_ISO
);

// Comments that contain [SELF-ASSIGNED]
const selfAssignedCommentsArbitrary = fc.array(
  fc.string().filter(s => s !== '[SELF-ASSIGNED]'),
  { minLength: 0, maxLength: 3 }
).map(arr => {
  const copy = [...arr];
  copy.splice(Math.floor(Math.random() * (copy.length + 1)), 0, '[SELF-ASSIGNED]');
  return copy;
});

// Comments that do NOT contain [SELF-ASSIGNED]
const adminCommentsArbitrary = fc.array(
  fc.string().filter(s => s !== '[SELF-ASSIGNED]'),
  { minLength: 0, maxLength: 3 }
);

// Generator for a single sub-task with random properties
const subTaskArbitrary = fc.record({
  id: fc.uuid(),
  delivery_id: fc.uuid(),
  status: statusArbitrary,
  comments: fc.oneof(selfAssignedCommentsArbitrary, adminCommentsArbitrary),
  finished_at: finishedAtArbitrary
});

// Generator for an aggregated task group containing random sub-tasks
const taskGroupArbitrary = fc.array(subTaskArbitrary, { minLength: 0, maxLength: 5 }).map(subTasks => ({
  id: 'group-1',
  name: 'Test Group',
  tasks: subTasks
}));

// Generator for an array of task groups
const taskGroupsArbitrary = fc.array(taskGroupArbitrary, { minLength: 0, maxLength: 5 });

/**
 * Helper: determine if a sub-task is eligible for delivery
 * (mirrors the expected logic for oracle comparison)
 */
function isEligible(subTask) {
  const isDone = subTask.status === 'DONE';
  const isAdmin = !Array.isArray(subTask.comments) || !subTask.comments.includes('[SELF-ASSIGNED]');
  const isToday = subTask.finished_at === TODAY_BRT_ISO;
  return isDone && isAdmin && isToday;
}

// Feature: app-enhancements, Property 5: Deliverable action filtering
describe('Auto-Delivery Property Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FAKE_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Property 5: Deliverable action filtering', () => {
    // **Validates: Requirements 4.1, 4.7**

    it('every returned sub-task has status DONE', () => {
      fc.assert(
        fc.property(taskGroupsArbitrary, (groups) => {
          const result = getDeliverableActions(groups);
          for (const task of result) {
            expect(task.status).toBe('DONE');
          }
        }),
        { numRuns: 100 }
      );
    });

    it('no returned sub-task is self-assigned', () => {
      fc.assert(
        fc.property(taskGroupsArbitrary, (groups) => {
          const result = getDeliverableActions(groups);
          for (const task of result) {
            const hasSelfAssigned = Array.isArray(task.comments) && task.comments.includes('[SELF-ASSIGNED]');
            expect(hasSelfAssigned).toBe(false);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('every returned sub-task has finished_at on today in BRT', () => {
      fc.assert(
        fc.property(taskGroupsArbitrary, (groups) => {
          const result = getDeliverableActions(groups);
          for (const task of result) {
            expect(task.finished_at).toBe(TODAY_BRT_ISO);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('all eligible sub-tasks from the input are present in the output (completeness)', () => {
      fc.assert(
        fc.property(taskGroupsArbitrary, (groups) => {
          const result = getDeliverableActions(groups);

          // Collect all eligible sub-tasks from input
          const expected = [];
          for (const group of groups) {
            if (group && Array.isArray(group.tasks)) {
              for (const subTask of group.tasks) {
                if (isEligible(subTask)) {
                  expected.push(subTask);
                }
              }
            }
          }

          expect(result).toHaveLength(expected.length);
          // Verify each expected task is in the result (by reference)
          for (const task of expected) {
            expect(result).toContain(task);
          }
        }),
        { numRuns: 100 }
      );
    });
  });
});


// Feature: app-enhancements, Property 6: Delivery resilience
describe('Property 6: Delivery resilience', () => {
  // **Validates: Requirements 4.6**

  let consoleErrorSpy;
  let consoleLogSpy;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Generator: random deliverable action (1-10 actions)
  const deliverableActionArbitrary = fc.record({
    delivery_id: fc.uuid(),
    finished_at: fc.constant('2024-06-15T15:00:00Z'),
    status: fc.constant('DONE'),
    comments: fc.constant([])
  });

  const deliverableActionsArbitrary = fc.array(deliverableActionArbitrary, { minLength: 1, maxLength: 10 });

  // Generator: for each action, randomly decide success or failure
  const outcomeArbitrary = fc.boolean(); // true = success, false = network error

  it('all N actions are attempted regardless of individual failures', () => {
    fc.assert(
      fc.asyncProperty(
        deliverableActionsArbitrary,
        fc.array(outcomeArbitrary, { minLength: 1, maxLength: 10 }),
        async (actions, outcomes) => {
          // Ensure outcomes array matches actions length
          const adjustedOutcomes = actions.map((_, i) =>
            i < outcomes.length ? outcomes[i] : true
          );

          let callIndex = 0;
          const spy = vi.spyOn(ApiClient, 'completeDelivery').mockImplementation(() => {
            const shouldSucceed = adjustedOutcomes[callIndex++];
            if (shouldSucceed) {
              return Promise.resolve({ status: 200 });
            } else {
              return Promise.reject(new Error('Network error'));
            }
          });

          await executeDeliveries(actions);

          // Property: number of API calls equals number of input actions
          expect(spy).toHaveBeenCalledTimes(actions.length);

          spy.mockRestore();
        }
      ),
      { numRuns: 100 }
    );
  });
});


// Feature: app-enhancements, Property 7: 18:00 BRT timer calculation
describe('Property 7: 18:00 BRT timer calculation', () => {
  // **Validates: Requirements 5.1, 5.3**

  const TARGET_HOUR_UTC = 21; // 18:00 BRT = 21:00 UTC
  const MS_PER_DAY = 86400000;

  // Generator: random timestamps across a wide range
  const timestampArbitrary = fc.integer({
    min: new Date('2020-01-01T00:00:00Z').getTime(),
    max: new Date('2030-12-31T23:59:59Z').getTime()
  }).map(ms => new Date(ms));

  it('now + delay equals the next occurrence of 21:00:00.000 UTC (18:00 BRT)', () => {
    fc.assert(
      fc.property(timestampArbitrary, (now) => {
        const delay = computeDelayToNextBRT18(now);
        const target = new Date(now.getTime() + delay);

        expect(target.getUTCHours()).toBe(TARGET_HOUR_UTC);
        expect(target.getUTCMinutes()).toBe(0);
        expect(target.getUTCSeconds()).toBe(0);
        expect(target.getUTCMilliseconds()).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it('if now is before 21:00 UTC today, target is today at 21:00 UTC', () => {
    // Generate timestamps that are strictly before 21:00 UTC on their day
    const beforeTargetArbitrary = timestampArbitrary.filter(d =>
      d.getUTCHours() < TARGET_HOUR_UTC
    );

    fc.assert(
      fc.property(beforeTargetArbitrary, (now) => {
        const delay = computeDelayToNextBRT18(now);
        const target = new Date(now.getTime() + delay);

        // Target should be same UTC date as now
        expect(target.getUTCFullYear()).toBe(now.getUTCFullYear());
        expect(target.getUTCMonth()).toBe(now.getUTCMonth());
        expect(target.getUTCDate()).toBe(now.getUTCDate());
        expect(target.getUTCHours()).toBe(TARGET_HOUR_UTC);
      }),
      { numRuns: 100 }
    );
  });

  it('if now is at or after 21:00 UTC today, target is tomorrow at 21:00 UTC', () => {
    // Generate timestamps that are at or after 21:00 UTC on their day
    const atOrAfterTargetArbitrary = timestampArbitrary.filter(d => {
      return d.getUTCHours() >= TARGET_HOUR_UTC;
    });

    fc.assert(
      fc.property(atOrAfterTargetArbitrary, (now) => {
        const delay = computeDelayToNextBRT18(now);
        const target = new Date(now.getTime() + delay);

        // Target should be the next day at 21:00 UTC
        const expectedTarget = new Date(Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() + 1,
          TARGET_HOUR_UTC, 0, 0, 0
        ));

        expect(target.getTime()).toBe(expectedTarget.getTime());
      }),
      { numRuns: 100 }
    );
  });

  it('the delay is always positive (> 0)', () => {
    fc.assert(
      fc.property(timestampArbitrary, (now) => {
        const delay = computeDelayToNextBRT18(now);
        expect(delay).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('the delay is at most 24 hours (86400000 ms)', () => {
    fc.assert(
      fc.property(timestampArbitrary, (now) => {
        const delay = computeDelayToNextBRT18(now);
        expect(delay).toBeLessThanOrEqual(MS_PER_DAY);
      }),
      { numRuns: 100 }
    );
  });
});


// Feature: app-enhancements, Property 8: Failed delivery error message
describe('Property 8: Failed delivery error message', () => {
  // **Validates: Requirements 5.5**

  // Generator: random positive integers (1-1000)
  const positiveIntArbitrary = fc.integer({ min: 1, max: 1000 });

  it('error message contains the failed count N as a substring', () => {
    fc.assert(
      fc.property(positiveIntArbitrary, (n) => {
        const message = formatDeliveryErrorMessage(n);
        expect(message).toContain(String(n));
      }),
      { numRuns: 100 }
    );
  });
});
