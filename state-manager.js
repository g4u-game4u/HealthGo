/**
 * State Manager Module
 * Manages application state and coordinates UI updates
 * Requirements: 1.4, 5.1, 5.3
 */

/**
 * Initial application state
 * @type {Object}
 */
const initialState = {
  isAuthenticated: false,
  user: null,
  tasks: [],
  isLoading: false,
  error: null,
  pendingChanges: [] // Queue of pending API requests
};

/**
 * Create a new state manager instance
 * @returns {Object} State manager with getState, setState, subscribe, notify, and reset methods
 */
export function createStateManager() {
  let state = { ...initialState };
  let subscribers = [];

  return {
    /**
     * Get current application state (immutable copy)
     * @returns {Object} Current state
     */
    getState() {
      return { ...state };
    },

    /**
     * Update state with partial state object (immutable)
     * @param {Object} partial - Partial state to merge
     */
    setState(partial) {
      state = { ...state, ...partial };
      this.notify();
    },

    /**
     * Subscribe to state changes
     * @param {Function} listener - Callback function
     * @returns {Function} Unsubscribe function
     */
    subscribe(listener) {
      subscribers.push(listener);
      return () => {
        subscribers = subscribers.filter(l => l !== listener);
      };
    },

    /**
     * Notify all subscribers of state change
     */
    notify() {
      subscribers.forEach(listener => listener(state));
    },

    /**
     * Reset state to initial unauthenticated state
     * Used for logout or session expiry (Requirement 5.3)
     */
    reset() {
      state = { ...initialState };
      this.notify();
    },

    /**
     * Set error state (Requirement 5.1)
     * @param {string} errorMessage - Error message to set
     */
    setError(errorMessage) {
      state = { ...state, error: errorMessage, isLoading: false };
      this.notify();
    },

    /**
     * Clear error state
     */
    clearError() {
      state = { ...state, error: null };
      this.notify();
    },

    /**
     * Get subscriber count (for testing)
     * @returns {number} Number of subscribers
     */
    getSubscriberCount() {
      return subscribers.length;
    }
  };
}

// Default singleton instance for the application
export const StateManager = createStateManager();
