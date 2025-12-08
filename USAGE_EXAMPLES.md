# Usage Examples: Optimistic Update System

## Scenario 1: User Rapidly Taps Multiple Tasks

### User Actions
```
1. Tap Task A (increment)
2. Tap Task B (increment)
3. Tap Task A again (increment)
4. Swipe Task C (decrement)
```

### What Happens

#### Immediate (< 10ms)
```
✓ Task A: 3/10 → 4/10 (UI updates instantly)
✓ Task B: 5/10 → 6/10 (UI updates instantly)
✓ Task A: 4/10 → 5/10 (UI updates instantly)
✓ Task C: 8/10 → 7/10 (UI updates instantly)
✓ Sync indicator shows: ⟳ 4
```

#### Background (non-blocking)
```
Queue: [
  { taskId: 'A', action: 'increment', ... },
  { taskId: 'B', action: 'increment', ... },
  { taskId: 'A', action: 'increment', ... },
  { taskId: 'C', action: 'decrement', ... }
]

Processing:
1. API: Mark Task A oldest PENDING as DONE ✓
   Queue: 3 items remaining
   Sync indicator: ⟳ 3

2. API: Mark Task B oldest PENDING as DONE ✓
   Queue: 2 items remaining
   Sync indicator: ⟳ 2

3. API: Mark Task A oldest PENDING as DONE ✓
   Queue: 1 item remaining
   Sync indicator: ⟳ 1

4. API: Reopen Task C newest DONE ✓
   Queue: 0 items remaining
   Sync indicator: Hidden
```

## Scenario 2: Network Failure During Processing

### User Actions
```
1. Tap Task A (increment)
2. Network goes down
3. Tap Task B (increment)
```

### What Happens

#### Immediate
```
✓ Task A: 3/10 → 4/10 (UI updates)
✓ Task B: 5/10 → 6/10 (UI updates)
✓ Sync indicator: ⟳ 2
```

#### Background
```
Queue: [
  { taskId: 'A', action: 'increment', ... },
  { taskId: 'B', action: 'increment', ... }
]

Processing:
1. API: Mark Task A oldest PENDING as DONE
   ✗ Network Error
   → Keep in queue, stop processing
   
Queue remains: [
  { taskId: 'A', action: 'increment', ... },
  { taskId: 'B', action: 'increment', ... }
]

Sync indicator: ⟳ 2 (still showing)
```

#### When Network Returns
```
User taps Task C (increment)
→ Triggers processQueue() again

Processing resumes:
1. API: Mark Task A oldest PENDING as DONE ✓
2. API: Mark Task B oldest PENDING as DONE ✓
3. API: Mark Task C oldest PENDING as DONE ✓

Queue: Empty
Sync indicator: Hidden
```

## Scenario 3: Conflict Detection During Sync

### Setup
```
Local State:
- Task A: 5/10 (user just incremented)

Backend State (another user updated):
- Task A: 7/10 (someone else incremented twice)
```

### What Happens

#### At 60-second sync
```
1. Check queue: Empty ✓
2. Fetch from backend
3. Compare:
   Local:   Task A = 5/10
   Backend: Task A = 7/10
   → Conflict detected!

4. Update state with backend data:
   Task A: 7/10 (backend wins)
   hasConflict: true
   conflictTimestamp: 1234567890

5. UI re-renders:
   ╔═══════════════════════════════╗  ← Red pulsing ring
   ║  Task A                       ║
   ║  7 / 10                       ║  ← Updated count
   ║  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░         ║
   ╚═══════════════════════════════╝

6. After 3 seconds:
   Red ring disappears
   hasConflict: false
```

## Scenario 4: Session Expires During Queue Processing

### User Actions
```
1. Tap Task A (increment)
2. Tap Task B (increment)
3. Session expires (token invalid)
```

### What Happens

#### Immediate
```
✓ Task A: 3/10 → 4/10 (UI updates)
✓ Task B: 5/10 → 6/10 (UI updates)
✓ Sync indicator: ⟳ 2
```

#### Background
```
Queue: [
  { taskId: 'A', action: 'increment', ... },
  { taskId: 'B', action: 'increment', ... }
]

Processing:
1. API: Mark Task A oldest PENDING as DONE
   ✗ 401 Unauthorized → SESSION_EXPIRED
   
2. Clear entire queue
   Queue: []

3. Stop sync timer

4. Logout user
   → Redirect to login screen
   → Show toast: "Session expired. Please log in again."
```

## Scenario 5: User Works Offline Then Comes Online

### User Actions (Offline)
```
1. Tap Task A (increment) - Network down
2. Tap Task B (increment) - Network down
3. Tap Task C (increment) - Network down
```

### What Happens

#### While Offline
```
✓ All UI updates happen instantly
✓ All changes queued
✓ Sync indicator: ⟳ 3
✓ API requests fail silently, stay in queue
```

#### When Network Returns
```
User taps Task D (increment)
→ Triggers processQueue()

Processing:
1. API: Mark Task A oldest PENDING as DONE ✓
2. API: Mark Task B oldest PENDING as DONE ✓
3. API: Mark Task C oldest PENDING as DONE ✓
4. API: Mark Task D oldest PENDING as DONE ✓

Queue: Empty
Sync indicator: Hidden
```

## Code Examples

### Enqueue an Update
```javascript
// User taps task
SyncQueue.enqueue({
  taskId: 'task-123',
  action: 'increment',
  task: aggregatedTask
});

// UI updates immediately
// Queue processes in background
```

### Check Queue Status
```javascript
const status = SyncQueue.getStatus();
console.log(`Queue length: ${status.queueLength}`);
console.log(`Is processing: ${status.isProcessing}`);
```

### Manual Sync
```javascript
// Force a sync (only if queue is empty)
await SyncQueue.syncWithBackend();
```

### Clear Conflict Manually
```javascript
// Remove conflict indicator from a task
SyncQueue.clearConflict('task-123');
```

### Change Sync Interval
```javascript
// Change from 60 seconds to 30 seconds
SyncQueue.SYNC_INTERVAL_MS = 30000;
SyncQueue.startPeriodicSync(); // Restart with new interval
```

## Testing the System

### Test Rapid Tapping
```javascript
// Simulate rapid user interactions
for (let i = 0; i < 10; i++) {
  UIController.handleTaskIncrement('task-1');
}

// Check queue
const status = SyncQueue.getStatus();
expect(status.queueLength).toBe(10);

// Wait for processing
await new Promise(resolve => setTimeout(resolve, 1000));

// Queue should be empty
expect(SyncQueue.getStatus().queueLength).toBe(0);
```

### Test Conflict Detection
```javascript
// Set local state
StateManager.setState({
  tasks: [{ id: 'task-1', executionCount: 5 }]
});

// Mock backend with different count
ApiClient.getTasks.mockResolvedValue([
  { id: 'task-1', executionCount: 7 }
]);

// Trigger sync
const result = await SyncQueue.syncWithBackend();

// Should detect conflict
expect(result[0].hasConflict).toBe(true);
expect(result[0].executionCount).toBe(7); // Backend wins
```

### Test Session Expiry
```javascript
// Mock session expiry
ApiClient.markOldestPendingAsDone.mockRejectedValue(
  new Error('SESSION_EXPIRED')
);

// Enqueue update
SyncQueue.enqueue({
  taskId: 'task-1',
  action: 'increment',
  task: mockTask
});

// Process queue
try {
  await SyncQueue.processQueue();
} catch (error) {
  expect(error.message).toBe('SESSION_EXPIRED');
}

// Queue should be cleared
expect(SyncQueue.getStatus().queueLength).toBe(0);
```
