/**
 * Auto-Delivery Module
 * Handles automatic delivery of completed admin-assigned actions
 * Requirements: 4.1, 4.7
 */

import { isSelfAssigned } from './task-utils.js';
import { ApiClient } from './api-client.js';
import { StateManager } from './state-manager.js';

/**
 * Check if a date string falls on today in BRT (UTC-3)
 * @param {string} dateString - ISO 8601 date string
 * @returns {boolean}
 */
export function isTodayBRT(dateString) {
  if (!dateString) return false;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return false;

  const now = new Date();
  const BRT_OFFSET_MS = -3 * 60 * 60 * 1000;

  // Convert both to BRT by applying UTC-3 offset
  const brtNow = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + BRT_OFFSET_MS);
  const brtDate = new Date(date.getTime() + date.getTimezoneOffset() * 60000 + BRT_OFFSET_MS);

  return (
    brtNow.getFullYear() === brtDate.getFullYear() &&
    brtNow.getMonth() === brtDate.getMonth() &&
    brtNow.getDate() === brtDate.getDate()
  );
}

/**
 * Get deliverable actions from aggregated task groups.
 * Filters for admin-assigned DONE tasks completed today (BRT).
 * Requirements: 4.1, 4.7
 * @param {Array} tasks - Aggregated task groups from state, each with a `tasks` sub-array
 * @returns {Array} Flat array of raw sub-tasks eligible for delivery
 */
export function getDeliverableActions(tasks) {
  if (!Array.isArray(tasks)) return [];

  const deliverable = [];

  for (const group of tasks) {
    if (!group || !Array.isArray(group.tasks)) continue;

    for (const subTask of group.tasks) {
      if (
        subTask &&
        subTask.status === 'DONE' &&
        !isSelfAssigned(subTask) &&
        isTodayBRT(subTask.finished_at)
      ) {
        deliverable.push(subTask);
      }
    }
  }

  return deliverable;
}

/**
 * Execute delivery for all eligible actions.
 * All N actions must be attempted regardless of individual failures (Property 6).
 * Requirements: 4.2, 4.3, 4.4, 4.6
 * @param {Array} deliverableActions - Raw sub-tasks to deliver
 * @returns {Promise<{succeeded: number, failed: number, errors: Array}>}
 */
export async function executeDeliveries(deliverableActions) {
  const result = { succeeded: 0, failed: 0, errors: [] };

  if (!Array.isArray(deliverableActions) || deliverableActions.length === 0) {
    return result;
  }

  for (const action of deliverableActions) {
    try {
      const finishedAt = action.finished_at || new Date().toISOString();
      const response = await ApiClient.completeDelivery(action.delivery_id, finishedAt);

      if (response.status === 200) {
        result.succeeded++;
      } else if (response.status === 204) {
        console.log(`Delivery ${action.delivery_id} returned 204 (no content), continuing.`);
        result.succeeded++;
      }
    } catch (error) {
      console.error(`Delivery failed for ${action.delivery_id}:`, error.message || error);
      result.failed++;
      result.errors.push({
        delivery_id: action.delivery_id,
        error: error.message || String(error)
      });
    }
  }

  return result;
}

/**
 * Compute the delay in milliseconds until the next 18:00 BRT (21:00 UTC).
 * Exported for testing (Property 7).
 * Requirements: 5.1, 5.3
 * @param {Date} now - Current date/time
 * @returns {number} Delay in milliseconds until next 18:00 BRT
 */
export function computeDelayToNextBRT18(now) {
  const TARGET_HOUR_UTC = 21; // 18:00 BRT = 21:00 UTC

  // Build today's target: same date at 21:00:00.000 UTC
  const target = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    TARGET_HOUR_UTC,
    0,
    0,
    0
  ));

  // If now is at or past 21:00 UTC today, push target to tomorrow
  if (now.getTime() >= target.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }

  return target.getTime() - now.getTime();
}

/**
 * Schedule auto-delivery at the next 18:00 BRT (21:00 UTC).
 * On trigger: gets tasks from StateManager, filters deliverables, executes deliveries.
 * If there are failures, calls onDeliveryComplete with the error count.
 * Requirements: 5.1, 5.2, 5.3, 5.4
 * @param {Function} [onDeliveryComplete] - Optional callback receiving the number of failed deliveries
 * @returns {number} Timer ID for cancellation
 */
export function scheduleEndOfDayDelivery(onDeliveryComplete) {
  const delay = computeDelayToNextBRT18(new Date());

  const timerId = setTimeout(async () => {
    try {
      const state = StateManager.getState();
      const tasks = state.tasks || [];
      const deliverableActions = getDeliverableActions(tasks);
      const result = await executeDeliveries(deliverableActions);

      if (result.failed > 0 && typeof onDeliveryComplete === 'function') {
        onDeliveryComplete(result.failed);
      }
    } catch (error) {
      console.error('End-of-day auto-delivery error:', error);
    }
  }, delay);

  return timerId;
}

/**
 * Cancel a previously scheduled delivery timer.
 * Requirements: 5.4
 * @param {number} timerId - Timer ID returned by scheduleEndOfDayDelivery
 */
export function cancelScheduledDelivery(timerId) {
  clearTimeout(timerId);
}

/**
 * Format error message for failed deliveries.
 * Requirements: 5.5
 * @param {number} failedCount - Number of failed deliveries
 * @returns {string} Error message containing the count
 */
export function formatDeliveryErrorMessage(failedCount) {
  return `${failedCount} delivery(ies) failed. Please check and retry.`;
}


export const AutoDelivery = {
  getDeliverableActions,
  executeDeliveries,
  computeDelayToNextBRT18,
  scheduleEndOfDayDelivery,
  cancelScheduledDelivery,
  formatDeliveryErrorMessage
};
