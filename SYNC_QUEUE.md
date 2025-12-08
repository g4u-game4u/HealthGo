# Optimistic Update System with Background Sync

## Overview

The application now features an optimistic update system that provides instant UI feedback while queuing API requests in the background. This prevents the UI from blocking when users rapidly interact with tasks.

## How It Works

### 1. Optimistic Updates
When a user taps or swipes on a task:
- The UI updates **immediately** (no waiting for API response)
- The change is added to a background queue
- The user can continue interacting without delays

### 2. Background Queue Processing
- API requests are processed in the background, one at a time
- If a request fails, it stays in the queue and retries later
- If the session expires, the queue is cleared and the user is logged out

### 3. Periodic Sync (Every 60 seconds)
- The app syncs with the backend every minute
- Sync only happens when the queue is empty (no pending changes)
- If backend data differs from local data, conflicts are detected

### 4. Conflict Detection
When a sync detects differences:
- The task card shows a **red glow** (pulsing ring) for 3 seconds
- The backend data is considered the source of truth
- The conflict indicator auto-clears after 3 seconds

## Visual Indicators

### Sync Status Indicator
- Located in the top-right corner of the task list screen
- Shows a spinning sync icon with the number of pending changes
- Only visible when there are items in the queue

### Conflict Indicator
- Task cards with conflicts show a red pulsing ring
- Automatically disappears after 3 seconds
- Indicates the task was corrected to match the backend

## Technical Details

### Files Modified
- `state-manager.js` - Added `pendingChanges` to state
- `sync-queue.js` - New module for queue management
- `app.js` - Integrated sync queue with UI controller
- `task-utils.js` - Added conflict styling to task cards
- `index.html` - Added sync indicator UI

### Key Functions

#### SyncQueue.enqueue(update)
Adds a task update to the queue and applies it optimistically.

#### SyncQueue.processQueue()
Processes queued updates in the background.

#### SyncQueue.syncWithBackend()
Fetches fresh data from backend and detects conflicts (only when queue is empty).

#### SyncQueue.clearConflict(taskId)
Removes conflict marker from a task.

### Configuration

```javascript
// Sync interval (default: 60 seconds)
SyncQueue.SYNC_INTERVAL_MS = 60000;
```

## Benefits

1. **Instant Feedback** - Users don't wait for API responses
2. **Resilient** - Failed requests are retried automatically
3. **Consistent** - Periodic sync ensures data matches backend
4. **Visual Feedback** - Users see when conflicts are resolved
5. **No Blocking** - Users can rapidly tap/swipe without delays

## Error Handling

- **Network Errors**: Requests stay in queue and retry later
- **Session Expiry**: Queue is cleared, user is logged out
- **Conflicts**: Backend data wins, user sees visual indicator
