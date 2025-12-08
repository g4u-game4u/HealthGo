# Architecture: Optimistic Update System

## System Components

```
┌─────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Task Cards  │  │ Sync Status  │  │   Conflict   │      │
│  │   (Tap/Swipe)│  │  Indicator   │  │   Indicator  │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
└─────────┼──────────────────┼──────────────────┼─────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                      UI CONTROLLER                           │
│  • handleTaskIncrement()                                     │
│  • handleTaskDecrement()                                     │
│  • updateSyncIndicator()                                     │
│  • renderTasks()                                             │
└─────────┬───────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                     STATE MANAGER                            │
│  {                                                           │
│    tasks: [...],                                             │
│    pendingChanges: [...],  ← NEW                             │
│    isAuthenticated: true,                                    │
│    ...                                                       │
│  }                                                           │
└─────────┬───────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                      SYNC QUEUE                              │
│  ┌────────────────────────────────────────────────┐         │
│  │  Queue: [update1, update2, update3, ...]       │         │
│  └────────────────────────────────────────────────┘         │
│                                                              │
│  • enqueue(update)         ← Add to queue                   │
│  • processQueue()          ← Process in background          │
│  • syncWithBackend()       ← Periodic sync (60s)            │
│  • detectConflicts()       ← Compare local vs backend       │
└─────────┬───────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                      API CLIENT                              │
│  • markOldestPendingAsDone()                                 │
│  • reopenNewestDoneTask()                                    │
│  • getTasks()                                                │
└─────────┬───────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                    BACKEND API                               │
│  https://g4u-mvp-api.onrender.com                            │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow: User Taps Task

```
1. User taps task card
   │
   ▼
2. UIController.handleTaskIncrement()
   │
   ├─► Optimistic Update (INSTANT)
   │   └─► StateManager.setState({ tasks: updatedTasks })
   │       └─► UI re-renders immediately
   │
   └─► SyncQueue.enqueue({ taskId, action, task })
       │
       ├─► Add to queue
       │   └─► StateManager.setState({ pendingChanges: [...] })
       │       └─► Sync indicator shows
       │
       └─► SyncQueue.processQueue() (background)
           │
           ├─► ApiClient.markOldestPendingAsDone()
           │   │
           │   ├─► Success
           │   │   └─► Remove from queue
           │   │       └─► Sync indicator updates
           │   │
           │   └─► Failure
           │       └─► Keep in queue
           │           └─► Retry later
           │
           └─► If SESSION_EXPIRED
               └─► Clear queue
                   └─► Logout user
```

## Data Flow: Periodic Sync

```
Every 60 seconds:
   │
   ▼
1. SyncQueue.syncWithBackend()
   │
   ├─► Check queue.length
   │   │
   │   ├─► If > 0: Skip sync
   │   │   └─► console.log('Skipping sync - pending changes')
   │   │
   │   └─► If = 0: Continue
   │
   ▼
2. ApiClient.getTasks()
   │
   ▼
3. Compare with local state
   │
   ├─► executionCount matches
   │   └─► No conflict
   │
   └─► executionCount differs
       └─► Mark as conflict
           │
           ├─► task.hasConflict = true
           ├─► task.conflictTimestamp = Date.now()
           │
           ▼
       4. StateManager.setState({ tasks: backendTasks })
           │
           ▼
       5. UI re-renders with red glow
           │
           ▼
       6. After 3 seconds: Auto-clear conflict
           └─► Red glow disappears
```

## Queue Processing Logic

```
┌─────────────────────────────────────────────────────────────┐
│                    QUEUE PROCESSOR                           │
│                                                              │
│  while (queue.length > 0) {                                  │
│    const update = queue[0];                                  │
│                                                              │
│    try {                                                     │
│      await processUpdate(update);                            │
│      queue.shift(); // Remove on success                     │
│    }                                                         │
│    catch (error) {                                           │
│      if (error === 'SESSION_EXPIRED') {                      │
│        queue = []; // Clear all                              │
│        throw error; // Logout                                │
│      }                                                       │
│      else {                                                  │
│        break; // Keep in queue, retry later                  │
│      }                                                       │
│    }                                                         │
│  }                                                           │
└─────────────────────────────────────────────────────────────┘
```

## Conflict Detection Algorithm

```javascript
function detectConflicts(localTasks, backendTasks) {
  return backendTasks.map(backendTask => {
    const localTask = localTasks.find(t => t.id === backendTask.id);
    
    // If counts differ, mark as conflict
    if (localTask && localTask.executionCount !== backendTask.executionCount) {
      return {
        ...backendTask,
        hasConflict: true,
        conflictTimestamp: Date.now()
      };
    }
    
    return backendTask; // No conflict
  });
}
```

## State Structure

```javascript
{
  // Existing state
  isAuthenticated: true,
  user: { id: '123', email: 'user@example.com' },
  tasks: [
    {
      id: 'task-1',
      name: 'Assembly Line Check',
      executionCount: 5,
      targetCount: 10,
      isCompleted: false,
      hasConflict: false,      // ← NEW: Conflict marker
      conflictTimestamp: null, // ← NEW: When conflict detected
      tasks: [...]             // Raw API tasks
    }
  ],
  isLoading: false,
  error: null,
  
  // NEW: Queue tracking
  pendingChanges: [
    {
      id: 'task-1-1234567890',
      taskId: 'task-1',
      action: 'increment',
      task: {...},
      timestamp: 1234567890
    }
  ]
}
```

## Visual Indicators

### Sync Status Indicator
```
┌─────────────────────────────────────┐
│  ⟳ 3  ← Spinning icon + count       │
└─────────────────────────────────────┘
```

### Conflict Indicator (Red Pulsing Ring)
```
┌─────────────────────────────────────┐
│  ╔═══════════════════════════════╗  │ ← Red ring
│  ║  Assembly Line Check          ║  │   (pulsing)
│  ║  5 / 10                       ║  │
│  ║  ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░         ║  │
│  ╚═══════════════════════════════╝  │
└─────────────────────────────────────┘
```

## Performance Characteristics

- **UI Update Latency**: < 10ms (instant)
- **Queue Processing**: Sequential, non-blocking
- **Sync Interval**: 60 seconds (configurable)
- **Conflict Display**: 3 seconds (auto-clear)
- **Memory Overhead**: Minimal (queue items are small)
- **Network Efficiency**: Batched processing, periodic sync
