import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDeliverableActions, isTodayBRT } from '../../auto-delivery.js';

describe('isTodayBRT', () => {
  beforeEach(() => {
    // Fix "now" to 2024-06-15 12:00:00 UTC (09:00 BRT)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true for a date that is today in BRT', () => {
    // 2024-06-15 15:00:00 UTC = 2024-06-15 12:00:00 BRT
    expect(isTodayBRT('2024-06-15T15:00:00Z')).toBe(true);
  });

  it('returns true for early morning UTC that is still today in BRT', () => {
    // 2024-06-15 02:00:00 UTC = 2024-06-14 23:00:00 BRT → yesterday in BRT
    expect(isTodayBRT('2024-06-15T02:00:00Z')).toBe(false);
  });

  it('returns true for a date right at BRT midnight boundary', () => {
    // 2024-06-15 03:00:00 UTC = 2024-06-15 00:00:00 BRT → today in BRT
    expect(isTodayBRT('2024-06-15T03:00:00Z')).toBe(true);
  });

  it('returns false for yesterday in BRT', () => {
    // 2024-06-14 10:00:00 UTC = 2024-06-14 07:00:00 BRT
    expect(isTodayBRT('2024-06-14T10:00:00Z')).toBe(false);
  });

  it('returns false for tomorrow in BRT', () => {
    // 2024-06-16 10:00:00 UTC = 2024-06-16 07:00:00 BRT
    expect(isTodayBRT('2024-06-16T10:00:00Z')).toBe(false);
  });

  it('returns false for null/undefined/empty', () => {
    expect(isTodayBRT(null)).toBe(false);
    expect(isTodayBRT(undefined)).toBe(false);
    expect(isTodayBRT('')).toBe(false);
  });

  it('returns false for invalid date string', () => {
    expect(isTodayBRT('not-a-date')).toBe(false);
  });
});

describe('getDeliverableActions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const todayISO = '2024-06-15T15:00:00Z'; // today in BRT
  const yesterdayISO = '2024-06-14T10:00:00Z';

  it('returns admin-assigned DONE tasks finished today in BRT', () => {
    const tasks = [
      {
        tasks: [
          { status: 'DONE', comments: [], finished_at: todayISO, delivery_id: 'd1' }
        ]
      }
    ];
    const result = getDeliverableActions(tasks);
    expect(result).toHaveLength(1);
    expect(result[0].delivery_id).toBe('d1');
  });

  it('excludes self-assigned tasks', () => {
    const tasks = [
      {
        tasks: [
          { status: 'DONE', comments: ['[SELF-ASSIGNED]'], finished_at: todayISO, delivery_id: 'd1' }
        ]
      }
    ];
    expect(getDeliverableActions(tasks)).toHaveLength(0);
  });

  it('excludes tasks not in DONE status', () => {
    const tasks = [
      {
        tasks: [
          { status: 'PENDING', comments: [], finished_at: todayISO, delivery_id: 'd1' },
          { status: 'DOING', comments: [], finished_at: todayISO, delivery_id: 'd2' },
          { status: 'DELIVERED', comments: [], finished_at: todayISO, delivery_id: 'd3' }
        ]
      }
    ];
    expect(getDeliverableActions(tasks)).toHaveLength(0);
  });

  it('excludes tasks finished on a different day', () => {
    const tasks = [
      {
        tasks: [
          { status: 'DONE', comments: [], finished_at: yesterdayISO, delivery_id: 'd1' }
        ]
      }
    ];
    expect(getDeliverableActions(tasks)).toHaveLength(0);
  });

  it('flattens sub-tasks from multiple groups', () => {
    const tasks = [
      {
        tasks: [
          { status: 'DONE', comments: [], finished_at: todayISO, delivery_id: 'd1' }
        ]
      },
      {
        tasks: [
          { status: 'DONE', comments: [], finished_at: todayISO, delivery_id: 'd2' }
        ]
      }
    ];
    const result = getDeliverableActions(tasks);
    expect(result).toHaveLength(2);
    expect(result.map(t => t.delivery_id)).toEqual(['d1', 'd2']);
  });

  it('handles empty input gracefully', () => {
    expect(getDeliverableActions([])).toEqual([]);
    expect(getDeliverableActions(null)).toEqual([]);
    expect(getDeliverableActions(undefined)).toEqual([]);
  });

  it('handles groups with missing tasks array', () => {
    const tasks = [{ name: 'group without tasks' }, null, { tasks: [] }];
    expect(getDeliverableActions(tasks)).toEqual([]);
  });
});

import { executeDeliveries } from '../../auto-delivery.js';
import { ApiClient } from '../../api-client.js';

describe('executeDeliveries', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns zero counts for empty input', async () => {
    const result = await executeDeliveries([]);
    expect(result).toEqual({ succeeded: 0, failed: 0, errors: [] });
  });

  it('returns zero counts for null input', async () => {
    const result = await executeDeliveries(null);
    expect(result).toEqual({ succeeded: 0, failed: 0, errors: [] });
  });

  it('counts 200 responses as succeeded', async () => {
    vi.spyOn(ApiClient, 'completeDelivery').mockResolvedValue({ status: 200 });

    const actions = [
      { delivery_id: 'd1', finished_at: '2024-06-15T15:00:00Z' },
      { delivery_id: 'd2', finished_at: '2024-06-15T16:00:00Z' }
    ];
    const result = await executeDeliveries(actions);

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.errors).toEqual([]);
    expect(ApiClient.completeDelivery).toHaveBeenCalledTimes(2);
  });

  it('counts 204 responses as succeeded and logs', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(ApiClient, 'completeDelivery').mockResolvedValue({ status: 204 });

    const actions = [{ delivery_id: 'd1', finished_at: '2024-06-15T15:00:00Z' }];
    const result = await executeDeliveries(actions);

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('204'));
    logSpy.mockRestore();
  });

  it('handles network errors: logs, increments failed, adds to errors, continues', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(ApiClient, 'completeDelivery')
      .mockResolvedValueOnce({ status: 200 })
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ status: 200 });

    const actions = [
      { delivery_id: 'd1', finished_at: '2024-06-15T15:00:00Z' },
      { delivery_id: 'd2', finished_at: '2024-06-15T16:00:00Z' },
      { delivery_id: 'd3', finished_at: '2024-06-15T17:00:00Z' }
    ];
    const result = await executeDeliveries(actions);

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].delivery_id).toBe('d2');
    expect(result.errors[0].error).toBe('Network error');
    // All 3 actions were attempted
    expect(ApiClient.completeDelivery).toHaveBeenCalledTimes(3);
    errorSpy.mockRestore();
  });

  it('attempts all N actions even when all fail (Property 6)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(ApiClient, 'completeDelivery').mockRejectedValue(new Error('fail'));

    const actions = [
      { delivery_id: 'd1', finished_at: '2024-06-15T15:00:00Z' },
      { delivery_id: 'd2', finished_at: '2024-06-15T16:00:00Z' },
      { delivery_id: 'd3', finished_at: '2024-06-15T17:00:00Z' }
    ];
    const result = await executeDeliveries(actions);

    expect(result.failed).toBe(3);
    expect(result.succeeded).toBe(0);
    expect(result.errors).toHaveLength(3);
    expect(ApiClient.completeDelivery).toHaveBeenCalledTimes(3);
  });

  it('uses current ISO timestamp when action has no finished_at', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
    vi.spyOn(ApiClient, 'completeDelivery').mockResolvedValue({ status: 200 });

    const actions = [{ delivery_id: 'd1' }];
    await executeDeliveries(actions);

    expect(ApiClient.completeDelivery).toHaveBeenCalledWith('d1', '2024-06-15T12:00:00.000Z');
    vi.useRealTimers();
  });
});
