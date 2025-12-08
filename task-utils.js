/**
 * Task Utilities Module
 * Pure functions for task rendering and sorting
 * Requirements: 2.2, 2.3, 2.4
 */

/**
 * Render a single task card HTML
 * @param {Object} task - Task object
 * @param {boolean} isCompleted - Whether task is completed
 * @returns {string} HTML string
 */
export function renderTaskCard(task, isCompleted) {
  const progress = task.targetCount > 0 ? (task.executionCount / task.targetCount) * 100 : 0;
  const teamInfo = task.teamName || '';
  
  if (isCompleted) {
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
  
  return `
    <button 
      class="task-card flex flex-col gap-4 rounded-xl bg-white dark:bg-zinc-800/50 p-6 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-left w-full ${conflictClass}"
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
 * Sort tasks with active first, completed last
 * @param {Array} tasks - Array of task objects
 * @returns {Array} Sorted tasks
 */
export function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    if (a.isCompleted === b.isCompleted) return 0;
    return a.isCompleted ? 1 : -1;
  });
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
