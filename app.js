/**
 * Factory Task Tracker Application
 * A headless web application for factory workers to track and execute repetitive tasks.
 */

// Import modules
import { StateManager } from './state-manager.js';
import { ApiClient } from './api-client.js';
import { SyncQueue } from './sync-queue.js';
import { validateCredentials } from './validation.js';
import { renderTaskCard, sortTasks, incrementExecutionCount, decrementExecutionCount, shouldTriggerCompletionPrompt, confirmCompletion, declineCompletion } from './task-utils.js';
import { AutoDelivery } from './auto-delivery.js';

// =============================================================================
// UI Controller Module
// =============================================================================

const UIController = {
  // DOM element references
  elements: {},

  /**
   * Initialize UI controller and cache DOM elements
   */
  init() {
    this.cacheElements();
    this.bindEvents();
    StateManager.subscribe(this.render.bind(this));
  },

  /**
   * Cache DOM element references
   */
  cacheElements() {
    this.elements = {
      // Screens
      loginScreen: document.getElementById('login-screen'),
      taskListScreen: document.getElementById('task-list-screen'),

      // Login form
      loginForm: document.getElementById('login-form'),
      emailInput: document.getElementById('email-input'),
      passwordInput: document.getElementById('password-input'),
      togglePassword: document.getElementById('toggle-password'),
      loginButton: document.getElementById('login-button'),
      loginButtonText: document.getElementById('login-button-text'),
      loginSpinner: document.getElementById('login-spinner'),
      emailError: document.getElementById('email-error'),
      passwordError: document.getElementById('password-error'),
      loginError: document.getElementById('login-error'),

      // Task list
      activeTasks: document.getElementById('active-tasks'),
      completedHeader: document.getElementById('completed-header'),
      completedTasks: document.getElementById('completed-tasks'),
      addActionButton: document.getElementById('add-action-button'),
      refreshButton: document.getElementById('refresh-button'),
      logoutButton: document.getElementById('logout-button'),
      syncIndicator: document.getElementById('sync-indicator'),
      syncCount: document.getElementById('sync-count'),

      // Modal
      completionModal: document.getElementById('completion-modal'),
      modalBackdrop: document.getElementById('modal-backdrop'),
      modalConfirm: document.getElementById('modal-confirm'),
      modalDecline: document.getElementById('modal-decline'),

      // Action template modal
      actionTemplateModal: document.getElementById('action-template-modal'),
      actionModalBackdrop: document.getElementById('action-modal-backdrop'),
      actionTemplateList: document.getElementById('action-template-list'),
      actionModalCancel: document.getElementById('action-modal-cancel'),

      // Points
      lockedPoints: document.getElementById('locked-points'),
      unlockedPoints: document.getElementById('unlocked-points'),

      // Toast
      errorToast: document.getElementById('error-toast'),
      errorToastMessage: document.getElementById('error-toast-message'),
      errorToastClose: document.getElementById('error-toast-close')
    };
  },

  /**
   * Bind event listeners
   */
  bindEvents() {
    // Login form events
    this.elements.loginForm?.addEventListener('submit', this.handleLogin.bind(this));
    this.elements.togglePassword?.addEventListener('click', this.togglePasswordVisibility.bind(this));

    // Task list events
    this.elements.refreshButton?.addEventListener('click', this.handleRefresh.bind(this));
    this.elements.logoutButton?.addEventListener('click', this.handleLogout.bind(this));
    this.elements.addActionButton?.addEventListener('click', this.handleAddAction.bind(this));

    // Modal events
    this.elements.modalConfirm?.addEventListener('click', this.handleConfirmCompletion.bind(this));
    this.elements.modalDecline?.addEventListener('click', this.handleDeclineCompletion.bind(this));
    this.elements.modalBackdrop?.addEventListener('click', this.handleDeclineCompletion.bind(this));

    // Action template modal events
    this.elements.actionModalBackdrop?.addEventListener('click', this.hideActionTemplateModal.bind(this));
    this.elements.actionModalCancel?.addEventListener('click', this.hideActionTemplateModal.bind(this));

    // Toast events
    this.elements.errorToastClose?.addEventListener('click', this.hideErrorToast.bind(this));
  },

  /**
   * Render UI based on current state
   * @param {Object} state - Current application state
   */
  render(state) {
    // Show/hide screens based on authentication
    if (state.isAuthenticated) {
      this.elements.loginScreen.classList.add('hidden');
      this.elements.taskListScreen.classList.remove('hidden');
      this.elements.taskListScreen.classList.add('flex');
      this.elements.addActionButton?.classList.remove('hidden');
      this.renderTasks(state.tasks);
      this.renderPoints(state.userPoints);
      this.updateSyncIndicator(state.pendingChanges);
    } else {
      this.elements.loginScreen.classList.remove('hidden');
      this.elements.taskListScreen.classList.add('hidden');
      this.elements.taskListScreen.classList.remove('flex');
      this.elements.addActionButton?.classList.add('hidden');
    }

    // Show error toast if error exists
    if (state.error) {
      this.showErrorToast(state.error);
    }
  },

  /**
   * Update sync indicator visibility and count
   * @param {Array} pendingChanges - Array of pending changes
   */
  updateSyncIndicator(pendingChanges = []) {
    if (pendingChanges.length > 0) {
      this.elements.syncIndicator.classList.remove('hidden');
      this.elements.syncIndicator.classList.add('flex');
      this.elements.syncCount.textContent = pendingChanges.length;
    } else {
      this.elements.syncIndicator.classList.add('hidden');
      this.elements.syncIndicator.classList.remove('flex');
    }
  },

  /**
   * Render points display
   * @param {Object} userPoints - { locked, unlocked }
   * Requirements: 6.2
   */
  renderPoints(userPoints) {
    const points = userPoints || { locked: 0, unlocked: 0 };
    if (this.elements.lockedPoints) {
      this.elements.lockedPoints.textContent = points.locked;
    }
    if (this.elements.unlockedPoints) {
      this.elements.unlockedPoints.textContent = points.unlocked;
    }
  },

  /**
   * Render task cards
   * @param {Array} tasks - Array of task objects
   */
  renderTasks(tasks) {
    const sortedTaskList = sortTasks(tasks);
    const activeTasks = sortedTaskList.filter(t => !t.isCompleted);
    const completedTaskList = sortedTaskList.filter(t => t.isCompleted);

    // Render active tasks
    this.elements.activeTasks.innerHTML = activeTasks.map(task => renderTaskCard(task, false)).join('');

    // Render completed tasks
    this.elements.completedTasks.innerHTML = completedTaskList.map(task => renderTaskCard(task, true)).join('');

    // Show/hide completed header
    if (completedTaskList.length > 0) {
      this.elements.completedHeader.classList.remove('hidden');
    } else {
      this.elements.completedHeader.classList.add('hidden');
    }

    // Bind task card events
    this.bindTaskCardEvents();

    // Auto-clear conflicts after render
    tasks.forEach(task => {
      if (task.hasConflict) {
        SyncQueue.autoClearConflict(task.id);
      }
    });
  },

  /**
   * Bind click and swipe events to task cards
   */
  bindTaskCardEvents() {
    const taskCards = document.querySelectorAll('.task-card');

    taskCards.forEach(card => {
      let startX = 0;
      let isDragging = false;

      // Click/tap handler for increment
      card.addEventListener('click', (e) => {
        // Only trigger if not a drag/swipe
        if (!isDragging) {
          const taskId = card.dataset.taskId;
          this.handleTaskIncrement(taskId);
        }
      });

      // Touch handlers for swipe detection
      card.addEventListener('touchstart', (e) => {
        startX = e.changedTouches[0].screenX;
        isDragging = false;
      }, { passive: true });

      card.addEventListener('touchend', (e) => {
        const endX = e.changedTouches[0].screenX;
        const swipeDistance = startX - endX;

        // Detect right-to-left swipe (minimum 50px)
        if (swipeDistance > 50) {
          isDragging = true;
          e.preventDefault();
          const taskId = card.dataset.taskId;
          this.handleTaskDecrement(taskId);
        }
      });

      // Mouse handlers for drag detection (desktop)
      card.addEventListener('mousedown', (e) => {
        startX = e.screenX;
        isDragging = false;
      });

      card.addEventListener('mouseup', (e) => {
        const endX = e.screenX;
        const swipeDistance = startX - endX;

        // Detect right-to-left drag (minimum 50px)
        if (swipeDistance > 50) {
          isDragging = true;
          e.preventDefault();
          e.stopPropagation();
          const taskId = card.dataset.taskId;
          this.handleTaskDecrement(taskId);
        }
      });

      // Prevent click after drag
      card.addEventListener('mouseleave', () => {
        isDragging = false;
      });
    });
  },

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  /**
   * Handle login form submission
   * @param {Event} e - Submit event
   */
  async handleLogin(e) {
    e.preventDefault();

    const email = this.elements.emailInput.value;
    const password = this.elements.passwordInput.value;

    // Validate credentials using exported function
    const validation = validateCredentials(email, password);

    if (!validation.isValid) {
      // Display validation errors inline
      this.displayValidationErrors(validation.errors);
      return;
    }

    // Show loading state
    this.setLoginLoading(true);
    this.clearErrors();

    try {
      const response = await ApiClient.login({ email: email.trim(), password });
      StateManager.setState({
        isAuthenticated: true,
        user: response.user,
        isLoading: false
      });

      // Fetch tasks after login
      await this.fetchTasks();

      // Fetch user points after login
      await this.fetchUserPoints();

      // Initialize sync queue
      SyncQueue.init();

      // Schedule 18:00 BRT auto-delivery timer
      const timerId = AutoDelivery.scheduleEndOfDayDelivery((failedCount) => {
        this.showErrorToast(AutoDelivery.formatDeliveryErrorMessage(failedCount));
      });
      StateManager.setState({ autoDeliveryTimerId: timerId });
    } catch (error) {
      StateManager.setState({
        error: error.message,
        isLoading: false
      });
      this.elements.loginError.textContent = error.message;
      this.elements.loginError.classList.remove('hidden');
    } finally {
      this.setLoginLoading(false);
    }
  },

  /**
   * Display validation errors inline
   * @param {Object} errors - { email?: string, password?: string }
   */
  displayValidationErrors(errors) {
    // Clear previous errors first
    this.elements.emailError.classList.add('hidden');
    this.elements.passwordError.classList.add('hidden');

    if (errors.email) {
      this.elements.emailError.textContent = errors.email;
      this.elements.emailError.classList.remove('hidden');
    }

    if (errors.password) {
      this.elements.passwordError.textContent = errors.password;
      this.elements.passwordError.classList.remove('hidden');
    }
  },

  /**
   * Set login button loading state
   * @param {boolean} isLoading - Whether loading
   */
  setLoginLoading(isLoading) {
    this.elements.loginButton.disabled = isLoading;
    if (isLoading) {
      this.elements.loginButtonText.classList.add('hidden');
      this.elements.loginSpinner.classList.remove('hidden');
    } else {
      this.elements.loginButtonText.classList.remove('hidden');
      this.elements.loginSpinner.classList.add('hidden');
    }
  },

  /**
   * Clear all error messages
   */
  clearErrors() {
    this.elements.emailError.classList.add('hidden');
    this.elements.passwordError.classList.add('hidden');
    this.elements.loginError.classList.add('hidden');
    StateManager.setState({ error: null });
  },

  /**
   * Toggle password visibility
   */
  togglePasswordVisibility() {
    const input = this.elements.passwordInput;
    const icon = this.elements.togglePassword.querySelector('.material-symbols-outlined');

    if (input.type === 'password') {
      input.type = 'text';
      icon.textContent = 'visibility_off';
    } else {
      input.type = 'password';
      icon.textContent = 'visibility';
    }
  },

  /**
   * Fetch tasks from API
   */
  async fetchTasks() {
    StateManager.setState({ isLoading: true });

    try {
      const tasks = await ApiClient.getTasks();
      StateManager.setState({ tasks, isLoading: false, error: null });
    } catch (error) {
      if (error.message === 'SESSION_EXPIRED') {
        this.handleSessionExpired();
      } else {
        StateManager.setState({ error: error.message, isLoading: false });
      }
    }
  },

  /**
   * Fetch user points from API
   * Requirements: 6.1, 6.4, 6.5, 6.6
   */
  async fetchUserPoints() {
    const state = StateManager.getState();
    const userId = state.user?.id || state.user?.user_id;
    if (!userId) return;

    try {
      const data = await ApiClient.getUserData(userId);
      StateManager.setState({
        userPoints: {
          locked: data.locked_points || 0,
          unlocked: data.unlocked_points || 0
        }
      });
    } catch (error) {
      if (error.message === 'SESSION_EXPIRED') {
        this.handleSessionExpired();
      }
      // Network error: keep last known values (don't update state)
    }
  },

  /**
   * Handle refresh button click
   */
  async handleRefresh() {
    await this.fetchTasks();
    await this.fetchUserPoints();
  },

  /**
   * Handle add action button click
   * Fetches action templates and opens the selection modal
   * Requirements: 1.1, 1.3
   */
  async handleAddAction() {
    try {
      const templates = await ApiClient.getActionTemplates();
      StateManager.setState({ actionTemplates: templates, isActionModalOpen: true });
      this.showActionTemplateModal(templates);
    } catch (error) {
      this.showErrorToast(error.message || 'Failed to load action templates');
    }
  },

  /**
   * Show action template selection modal
   * @param {Array} templates - Array of action template objects
   * Requirements: 1.1
   */
  showActionTemplateModal(templates) {
    const list = this.elements.actionTemplateList;
    list.innerHTML = templates.map(t =>
      `<button class="action-template-item w-full text-left px-4 py-3 rounded-lg border border-[#314d68] text-white hover:bg-white/10 transition-colors" data-template-id="${t.id}" data-template-title="${(t.title || '').replace(/"/g, '&quot;')}">${t.title || 'Untitled'}</button>`
    ).join('');

    // Bind click events on template items
    list.querySelectorAll('.action-template-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const template = { id: btn.dataset.templateId, title: btn.dataset.templateTitle };
        this.handleTemplateSelection(template);
      });
    });

    this.elements.actionTemplateModal.classList.remove('hidden');
  },

  /**
   * Hide action template selection modal
   */
  hideActionTemplateModal() {
    this.elements.actionTemplateModal.classList.add('hidden');
    this.elements.actionTemplateList.innerHTML = '';
    StateManager.setState({ isActionModalOpen: false });
  },

  /**
   * Handle selection of an action template
   * @param {Object} template - { id, title }
   * Requirements: 1.2, 1.4, 1.5
   */
  async handleTemplateSelection(template) {
    this.hideActionTemplateModal();
    try {
      await ApiClient.createSelfAssignedAction({
        action_template_id: template.id,
        user_email: ApiClient.userEmail,
        delivery_title: template.title
      });
      await this.fetchTasks();
    } catch (error) {
      this.showErrorToast(error.message || 'Failed to create action');
    }
  },

  /**
   * Handle logout button click
   * Requirements: 4.1, 4.2, 4.5, 5.4
   */
  async handleLogout() {
    // Stop sync queue
    SyncQueue.stop();
    SyncQueue.clearQueue();

    // Cancel 18:00 BRT timer
    const state = StateManager.getState();
    if (state.autoDeliveryTimerId) {
      AutoDelivery.cancelScheduledDelivery(state.autoDeliveryTimerId);
    }

    // Auto-deliver completed admin-assigned actions before logout
    try {
      const deliverableActions = AutoDelivery.getDeliverableActions(state.tasks);
      if (deliverableActions.length > 0) {
        await AutoDelivery.executeDeliveries(deliverableActions);
      }
    } catch (error) {
      console.error('Auto-delivery on logout failed:', error);
    }

    // Clear API token and user email
    ApiClient.setToken(null);
    ApiClient.setUserEmail(null);
    // Reset state to unauthenticated (redirects to login screen)
    StateManager.reset();
  },

  /**
   * Handle task increment (tap/click) - marks oldest PENDING as DONE
   * @param {string} taskId - Task ID (action_template_id)
   */
  async handleTaskIncrement(taskId) {
    const state = StateManager.getState();
    const taskGroup = state.tasks.find(t => t.id === taskId);

    if (!taskGroup) return;

    // If already completed, show reopen modal
    if (taskGroup.isCompleted) {
      this.showReopenModal(taskId);
      return;
    }

    // Find the oldest PENDING task to complete
    // We sort by created_at to ensure we're targeting a specific, deterministic task
    const pendingTasks = taskGroup.tasks
      .filter(t => t.status === 'PENDING')
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    if (pendingTasks.length === 0) return;

    // Target the specific task (first pending)
    const taskToComplete = pendingTasks[0];

    // Optimistic update - instant UI response
    // We update the specific sub-task's status in the local state
    // AND update the aggregate counts
    const newCount = taskGroup.executionCount + 1;

    const updatedTasks = state.tasks.map(t => {
      if (t.id === taskId) {
        // Create new tasks array with the specific task marked as DONE
        const newSubTasks = t.tasks.map(subTask =>
          subTask.id === taskToComplete.id
            ? { ...subTask, status: 'DONE', finished_at: new Date().toISOString() }
            : subTask
        );

        return {
          ...t,
          tasks: newSubTasks,
          executionCount: newCount,
          isCompleted: newCount === t.targetCount,
          hasConflict: false
        };
      }
      return t;
    });

    StateManager.setState({ tasks: updatedTasks });

    // Queue the API request with the ORIGINAL task state (before optimistic update)
    // This ensures the queue has the real backend state, not the optimistic UI state
    SyncQueue.enqueue({
      taskId,
      action: 'increment',
      originalTask: taskGroup // Pass original state before optimistic update
    });
  },

  /**
   * Handle task decrement (swipe left) - reopens newest DONE task
   * @param {string} taskId - Task ID (action_template_id)
   */
  async handleTaskDecrement(taskId) {
    const state = StateManager.getState();
    const taskGroup = state.tasks.find(t => t.id === taskId);

    if (!taskGroup) return;

    // Find newest DONE task to reopen
    const doneTasks = taskGroup.tasks
      .filter(t => t.status === 'DONE')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (doneTasks.length === 0) return;

    // Target the specific task (newest done)
    const taskToReopen = doneTasks[0];

    // Optimistic update - instant UI response
    const newCount = Math.max(taskGroup.executionCount - 1, 0);

    const updatedTasks = state.tasks.map(t => {
      if (t.id === taskId) {
        // Create new tasks array with the specific task marked as PENDING
        const newSubTasks = t.tasks.map(subTask =>
          subTask.id === taskToReopen.id
            ? { ...subTask, status: 'PENDING', finished_at: null }
            : subTask
        );

        return {
          ...t,
          tasks: newSubTasks,
          executionCount: newCount,
          isCompleted: false,
          hasConflict: false
        };
      }
      return t;
    });

    StateManager.setState({ tasks: updatedTasks });

    // Queue the API request with the ORIGINAL task state (before optimistic update)
    SyncQueue.enqueue({
      taskId,
      action: 'decrement',
      originalTask: taskGroup // Pass original state before optimistic update
    });
  },

  // ==========================================================================
  // Reopen Modal (for completed tasks)
  // ==========================================================================

  currentReopenTaskId: null,

  /**
   * Show reopen confirmation modal for completed tasks
   * @param {string} taskId - Task ID
   */
  showReopenModal(taskId) {
    this.currentReopenTaskId = taskId;
    // Reuse completion modal but change text
    const modalTitle = this.elements.completionModal.querySelector('h2');
    const modalText = this.elements.completionModal.querySelector('p');
    if (modalTitle) modalTitle.textContent = 'Reopen task?';
    if (modalText) modalText.textContent = 'This will decrease the completion count by 1.';
    this.elements.completionModal.classList.remove('hidden');
  },

  /**
   * Handle reopen confirmation
   */
  async handleReopenConfirm() {
    const taskId = this.currentReopenTaskId;
    if (!taskId) return;

    this.hideCompletionModal();
    this.currentReopenTaskId = null;

    // Trigger decrement which reopens the task
    await this.handleTaskDecrement(taskId);
  },

  // ==========================================================================
  // Completion Modal
  // ==========================================================================

  currentCompletionTaskId: null,

  /**
   * Show completion confirmation modal
   * @param {string} taskId - Task ID
   */
  showCompletionModal(taskId) {
    this.currentCompletionTaskId = taskId;
    this.elements.completionModal.classList.remove('hidden');
  },

  /**
   * Hide completion modal and reset state
   */
  hideCompletionModal() {
    this.currentCompletionTaskId = null;
    this.currentReopenTaskId = null;
    this.elements.completionModal.classList.add('hidden');

    // Reset modal text to default
    const modalTitle = this.elements.completionModal.querySelector('h2');
    const modalText = this.elements.completionModal.querySelector('p');
    if (modalTitle) modalTitle.textContent = 'Task completed?';
    if (modalText) modalText.textContent = 'Mark this task as complete?';
  },

  /**
   * Handle confirm button click (completion or reopen)
   */
  async handleConfirmCompletion() {
    // Check if this is a reopen action
    if (this.currentReopenTaskId) {
      await this.handleReopenConfirm();
      return;
    }

    // Otherwise it's a completion action (not used in current flow)
    this.hideCompletionModal();
  },

  /**
   * Handle decline completion button click
   */
  handleDeclineCompletion() {
    this.hideCompletionModal();
  },

  // ==========================================================================
  // Error Toast
  // ==========================================================================

  errorToastTimeout: null,

  /**
   * Show error toast notification
   * @param {string} message - Error message
   */
  showErrorToast(message) {
    this.elements.errorToastMessage.textContent = message;
    this.elements.errorToast.classList.remove('hidden');

    // Auto-dismiss after 5 seconds
    if (this.errorToastTimeout) {
      clearTimeout(this.errorToastTimeout);
    }
    this.errorToastTimeout = setTimeout(() => {
      this.hideErrorToast();
    }, 5000);
  },

  /**
   * Hide error toast and clear error state
   */
  hideErrorToast() {
    this.elements.errorToast.classList.add('hidden');
    if (this.errorToastTimeout) {
      clearTimeout(this.errorToastTimeout);
      this.errorToastTimeout = null;
    }
    // Clear error state after dismissing toast
    StateManager.setState({ error: null });
  },

  // ==========================================================================
  // Session Management
  // ==========================================================================

  /**
   * Handle session expiry
   * Clears auth state and redirects to login (Requirement 5.3)
   */
  handleSessionExpired() {
    // Stop sync queue
    SyncQueue.stop();
    SyncQueue.clearQueue();

    // Clear API token
    ApiClient.setToken(null);
    // Reset state to unauthenticated (redirects to login screen)
    StateManager.reset();
    // Show error message
    this.showErrorToast('Session expired. Please log in again.');
  }
};

// =============================================================================
// Application Initialization
// =============================================================================

/**
 * Initialize the application when DOM is ready
 */
document.addEventListener('DOMContentLoaded', () => {
  UIController.init();
});

// =============================================================================
// Exports for Testing
// =============================================================================

export { StateManager, ApiClient, UIController };
