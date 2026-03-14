/**
 * Task Utilities Module
 * Pure functions for task rendering and sorting
 * Requirements: 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4
 */

/**
 * Check if a task is self-assigned by inspecting comments for [SELF-ASSIGNED] marker
 * Requirements: 2.4
 * @param {Object} task - Raw task object
 * @returns {boolean}
 */
export function isSelfAssigned(task) {
  if (!task || !Array.isArray(task.comments)) {
    return false;
  }
  return task.comments.includes('[SELF-ASSIGNED]');
}

/**
 * Partition tasks into to-do and completed lists
 * To-Do: PENDING or DOING status
 * Completed: DONE status
 * DELIVERED: excluded from both
 * Requirements: 3.2, 3.3, 3.4
 * @param {Array} tasks - Array of task objects with status field (these are raw sub-tasks, not aggregated groups)
 * @returns {{ todo: Array, completed: Array }}
 */
export function partitionTasks(tasks) {
  const todo = [];
  const completed = [];
  for (const task of (tasks || [])) {
    if (task.status === 'PENDING' || task.status === 'DOING') {
      todo.push(task);
    } else if (task.status === 'DONE') {
      completed.push(task);
    }
    // DELIVERED is excluded from both lists
  }
  return { todo, completed };
}


/**
 * Get border color class for priority
 * Maps priority value to Tailwind border color class
 * Requirements: 2.2, 2.3, 2.4, 2.5
 * @param {number} priority - Priority value (1-10)
 * @returns {string} Tailwind border color class
 */
export function getPriorityBorderColor(priority) {
  // High priority (1-3): red
  if (priority >= 1 && priority <= 3) {
    return 'border-l-red-500';
  }
  // Medium priority (4-7): yellow
  if (priority >= 4 && priority <= 7) {
    return 'border-l-yellow-500';
  }
  // Low priority (8-10) or default: blue
  return 'border-l-blue-500';
}

/**
 * Extract priority from comments array
 * Parses "PRIORITY:X" pattern from comments, returns first match
 * Requirements: 3.1, 3.2, 3.3, 3.4
 * @param {string[]} comments - Array of comment strings
 * @returns {number} Priority value (1-10, default 10)
 */
export function extractPriority(comments) {
  // Handle null, undefined, or non-array inputs - default to 10
  if (!comments || !Array.isArray(comments) || comments.length === 0) {
    return 10;
  }

  // Search for first "PRIORITY:X" pattern (supports negative numbers)
  for (const comment of comments) {
    if (typeof comment !== 'string') continue;
    
    const match = comment.match(/PRIORITY:(-?\d+)/i);
    if (match) {
      const value = parseInt(match[1], 10);
      
      // Handle NaN case - default to 10
      if (isNaN(value)) {
        return 10;
      }
      
      // Clamp to valid range 1-10
      return Math.max(1, Math.min(10, value));
    }
  }

  // No PRIORITY pattern found - default to 10
  return 10;
}

/**
 * Render a single task card HTML
 * Requirements: 2.1 - Active task cards display colored left border indicating priority level
 * @param {Object} task - Task object with optional priority field
 * @param {boolean} isCompleted - Whether task is completed
 * @returns {string} HTML string
 */
export function renderTaskCard(task, isCompleted) {
  const progress = task.targetCount > 0 ? (task.executionCount / task.targetCount) * 100 : 0;
  const teamInfo = task.teamName || '';
  
  if (isCompleted) {
    // Check if any sub-task in the group is self-assigned (Requirements: 2.2, 2.3)
    const hasSelfAssigned = Array.isArray(task.tasks) && task.tasks.some(subTask => isSelfAssigned(subTask));

    if (hasSelfAssigned) {
      return `
        <button 
          class="task-card flex flex-col gap-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 p-6 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors text-left w-full cursor-pointer" 
          data-task-id="${task.id}"
        >
          <div class="flex items-center justify-between">
            <div class="flex flex-col gap-1">
              <p class="text-xl font-bold text-zinc-500 dark:text-zinc-400 line-through">${task.name}</p>
              ${teamInfo ? `<p class="text-sm text-zinc-400 dark:text-zinc-500">${teamInfo}</p>` : ''}
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold px-2 py-1 rounded-full bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200">Awaiting approval</span>
              <span class="material-symbols-outlined text-3xl text-amber-500" style="font-variation-settings: 'FILL' 1;">hourglass_top</span>
            </div>
          </div>
          <div class="w-full overflow-hidden rounded-full bg-zinc-300 dark:bg-zinc-700 h-2.5">
            <div class="h-full rounded-full bg-amber-500" style="width: 100%;"></div>
          </div>
        </button>
      `;
    }

    return `
      <button 
        class="task-card flex flex-col gap-4 rounded-xl bg-zinc-100 dark:bg-zinc-800/30 p-6 hover:bg-zinc-200 dark:hover:bg-zinc-800/50 transition-colors text-left w-full cursor-pointer" 
        data-task-id="${task.id}"
      >
        <div class="flex items-center justify-between">
          <div class="flex flex-col gap-1">
            <p class="text-xl font-bold text-zinc-500 dark:text-zinc-400 line-through">${task.name}</p>
            ${teamInfo ? `<p class="text-sm text-zinc-400 dark:text-zinc-500">${teamInfo}</p>` : ''}
          </div>
          <span class="material-symbols-outlined text-3xl text-green-500" style="font-variation-settings: 'FILL' 1;">check_circle</span>
        </div>
        <div class="w-full overflow-hidden rounded-full bg-zinc-300 dark:bg-zinc-700 h-2.5">
          <div class="h-full rounded-full bg-green-500" style="width: 100%;"></div>
        </div>
      </button>
    `;
  }

  // Add conflict styling if task has conflict
  const conflictClass = task.hasConflict ? 'ring-2 ring-red-500 animate-pulse' : '';
  
  // Get priority border color for active tasks (Requirements: 2.1)
  const priority = task.priority ?? 10;
  const priorityBorderColor = getPriorityBorderColor(priority);
  
  return `
    <button 
      class="task-card flex flex-col gap-4 rounded-xl bg-white dark:bg-zinc-800/50 p-6 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-left w-full border-l-4 ${priorityBorderColor} ${conflictClass}"
      data-task-id="${task.id}"
    >
      <div class="flex items-center justify-between">
        <div class="flex flex-col gap-1">
          <p class="text-xl font-bold text-zinc-900 dark:text-white">${task.name}</p>
          ${teamInfo ? `<p class="text-sm text-zinc-500 dark:text-zinc-400">${teamInfo}</p>` : ''}
        </div>
        <p class="text-lg font-medium text-zinc-500 dark:text-zinc-400">${task.executionCount} / ${task.targetCount}</p>
      </div>
      <div class="w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700 h-2.5">
        <div class="h-full rounded-full bg-primary" style="width: ${progress}%;"></div>
      </div>
    </button>
  `;
}

/**
 * Sort tasks with active first (sorted by priority ascending), completed last
 * Requirements: 1.1, 1.3, 1.4
 * @param {Array} tasks - Array of task objects with optional priority field
 * @returns {Array} Sorted tasks - active tasks by priority (1 first, 10 last), then completed
 */
export function sortTasks(tasks) {
  // Create a copy with original indices for stable sort
  const tasksWithIndex = tasks.map((task, index) => ({ task, originalIndex: index }));
  
  tasksWithIndex.sort((a, b) => {
    // First: separate active from completed (active first)
    if (a.task.isCompleted !== b.task.isCompleted) {
      return a.task.isCompleted ? 1 : -1;
    }
    
    // For active tasks: sort by priority ascending (1 first, 10 last)
    if (!a.task.isCompleted) {
      const priorityA = a.task.priority ?? 10;
      const priorityB = b.task.priority ?? 10;
      
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
    }
    
    // For equal priorities or completed tasks: maintain original order (stable sort)
    return a.originalIndex - b.originalIndex;
  });
  
  return tasksWithIndex.map(item => item.task);
}

/**
 * Increment task execution count by 1, capped at targetCount
 * Requirements: 3.1
 * @param {Object} task - Task object with executionCount and targetCount
 * @returns {number} New execution count
 */
export function incrementExecutionCount(task) {
  if (task.isCompleted) {
    return task.executionCount;
  }
  return Math.min(task.executionCount + 1, task.targetCount);
}

/**
 * Decrement task execution count by 1, floored at 0
 * Requirements: 3.2
 * @param {Object} task - Task object with executionCount
 * @returns {number} New execution count
 */
export function decrementExecutionCount(task) {
  if (task.isCompleted) {
    return task.executionCount;
  }
  return Math.max(task.executionCount - 1, 0);
}

/**
 * Check if completion prompt should be triggered after an increment
 * Requirements: 4.1
 * @param {Object} task - Task object before increment
 * @param {number} newCount - The new execution count after increment
 * @returns {boolean} True if completion prompt should be shown
 */
export function shouldTriggerCompletionPrompt(task, newCount) {
  // Only trigger if task is not already completed and new count equals target
  return !task.isCompleted && newCount === task.targetCount;
}

/**
 * Confirm task completion - returns updated task with isCompleted=true
 * Requirements: 4.2
 * @param {Object} task - Task object at target count
 * @returns {Object} Updated task with isCompleted=true
 */
export function confirmCompletion(task) {
  // Only mark complete if at target count
  if (task.executionCount === task.targetCount) {
    return { ...task, isCompleted: true };
  }
  return task;
}

/**
 * Decline task completion - returns task unchanged (stays active)
 * Requirements: 4.3
 * @param {Object} task - Task object at target count
 * @returns {Object} Same task with isCompleted=false
 */
export function declineCompletion(task) {
  // Task remains active (isCompleted stays false)
  return { ...task, isCompleted: false };
}

/**
 * Render points display HTML
 * Requirements: 6.2
 * @param {{ locked: number, unlocked: number }} userPoints
 * @returns {string} HTML string containing both point values
 */
export function renderPointsHTML(userPoints) {
  const points = userPoints || { locked: 0, unlocked: 0 };
  return `<span class="locked-points">${points.locked}</span><span class="unlocked-points">${points.unlocked}</span>`;
}
