/**
 * Factory Task Tracker Application
 * A headless web application for factory workers to track and execute repetitive tasks.
 */

// Import modules
import { StateManager } from './state-manager.js';
import { ApiClient } from './api-client.js';
import { validateCredentials } from './validation.js';
import { renderTaskCard, sortTasks, incrementExecutionCount, decrementExecutionCount, shouldTriggerCompletionPrompt, confirmCompletion, declineCompletion } from './task-utils.js';

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
      refreshButton: document.getElementById('refresh-button'),
      logoutButton: document.getElementById('logout-button'),
      
      // Modal
      completionModal: document.getElementById('completion-modal'),
      modalBackdrop: document.getElementById('modal-backdrop'),
      modalConfirm: document.getElementById('modal-confirm'),
      modalDecline: document.getElementById('modal-decline'),
      
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
    
    // Modal events
    this.elements.modalConfirm?.addEventListener('click', this.handleConfirmCompletion.bind(this));
    this.elements.modalDecline?.addEventListener('click', this.handleDeclineCompletion.bind(this));
    this.elements.modalBackdrop?.addEventListener('click', this.handleDeclineCompletion.bind(this));
    
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
      this.renderTasks(state.tasks);
    } else {
      this.elements.loginScreen.classList.remove('hidden');
      this.elements.taskListScreen.classList.add('hidden');
      this.elements.taskListScreen.classList.remove('flex');
    }

    // Show error toast if error exists
    if (state.error) {
      this.showErrorToast(state.error);
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
  },

  /**
   * Bind click and swipe events to task cards
   */
  bindTaskCardEvents() {
    const taskCards = document.querySelectorAll('.task-card');
    
    taskCards.forEach(card => {
      let touchStartX = 0;
      
      // Click/tap handler for increment
      card.addEventListener('click', () => {
        const taskId = card.dataset.taskId;
        this.handleTaskIncrement(taskId);
      });
      
      // Touch handlers for swipe detection
      card.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
      }, { passive: true });
      
      card.addEventListener('touchend', (e) => {
        const touchEndX = e.changedTouches[0].screenX;
        const swipeDistance = touchStartX - touchEndX;
        
        // Detect right-to-left swipe (minimum 50px)
        if (swipeDistance > 50) {
          e.preventDefault();
          const taskId = card.dataset.taskId;
          this.handleTaskDecrement(taskId);
        }
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
   * Handle refresh button click
   */
  async handleRefresh() {
    await this.fetchTasks();
  },

  /**
   * Handle logout button click
   */
  handleLogout() {
    // Clear API token and user email
    ApiClient.setToken(null);
    ApiClient.setUserEmail(null);
    // Reset state to unauthenticated (redirects to login screen)
    StateManager.reset();
  },

  /**
   * Handle task increment (tap/click)
   * @param {string} taskId - Task ID
   */
  async handleTaskIncrement(taskId) {
    const state = StateManager.getState();
    const task = state.tasks.find(t => t.id === taskId);
    
    if (!task || task.isCompleted) return;
    
    // Calculate new count using pure function (cap at targetCount)
    const newCount = incrementExecutionCount(task);
    
    // Optimistic update
    const updatedTasks = state.tasks.map(t => 
      t.id === taskId ? { ...t, executionCount: newCount } : t
    );
    StateManager.setState({ tasks: updatedTasks });
    
    // Persist to API
    try {
      await ApiClient.updateTaskExecution(taskId, newCount);
      
      // Check if completion prompt should be triggered using pure function
      if (shouldTriggerCompletionPrompt(task, newCount)) {
        this.showCompletionModal(taskId);
      }
    } catch (error) {
      // Revert optimistic update on failure
      if (error.message === 'SESSION_EXPIRED') {
        this.handleSessionExpired();
      } else {
        StateManager.setState({ tasks: state.tasks, error: error.message });
      }
    }
  },

  /**
   * Handle task decrement (swipe left)
   * @param {string} taskId - Task ID
   */
  async handleTaskDecrement(taskId) {
    const state = StateManager.getState();
    const task = state.tasks.find(t => t.id === taskId);
    
    if (!task || task.isCompleted) return;
    
    // Calculate new count using pure function (floor at 0)
    const newCount = decrementExecutionCount(task);
    
    // Optimistic update
    const updatedTasks = state.tasks.map(t => 
      t.id === taskId ? { ...t, executionCount: newCount } : t
    );
    StateManager.setState({ tasks: updatedTasks });
    
    // Persist to API
    try {
      await ApiClient.updateTaskExecution(taskId, newCount);
    } catch (error) {
      // Revert optimistic update on failure
      if (error.message === 'SESSION_EXPIRED') {
        this.handleSessionExpired();
      } else {
        StateManager.setState({ tasks: state.tasks, error: error.message });
      }
    }
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
   * Hide completion modal
   */
  hideCompletionModal() {
    this.currentCompletionTaskId = null;
    this.elements.completionModal.classList.add('hidden');
  },

  /**
   * Handle confirm completion button click
   */
  async handleConfirmCompletion() {
    const taskId = this.currentCompletionTaskId;
    if (!taskId) return;
    
    const state = StateManager.getState();
    const task = state.tasks.find(t => t.id === taskId);
    
    if (!task) return;
    
    // Use pure function to get completed task
    const completedTask = confirmCompletion(task);
    
    // Optimistic update
    const updatedTasks = state.tasks.map(t => 
      t.id === taskId ? completedTask : t
    );
    StateManager.setState({ tasks: updatedTasks });
    
    this.hideCompletionModal();
    
    // Persist to API
    try {
      await ApiClient.markTaskComplete(taskId);
    } catch (error) {
      // Revert optimistic update on failure
      if (error.message === 'SESSION_EXPIRED') {
        this.handleSessionExpired();
      } else {
        StateManager.setState({ tasks: state.tasks, error: error.message });
      }
    }
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
