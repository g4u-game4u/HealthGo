/**
 * API Client Module
 * Handles all communication with the G4U API
 */

export const API_BASE_URL = 'https://g4u-mvp-api-staging.onrender.com';

export const ApiClient = {
  token: null,
  userEmail: null,

  /**
   * Set the authentication token for API requests
   * @param {string} token - JWT token
   */
  setToken(token) {
    this.token = token;
  },

  /**
   * Set the user email for API requests
   * @param {string} email - User email
   */
  setUserEmail(email) {
    this.userEmail = email;
  },

  /**
   * Get base headers (required for all requests)
   * @returns {Object} Headers object with client_id
   */
  getBaseHeaders() {
    return {
      'Content-Type': 'application/json',
      'client_id': 'template'
    };
  },

  /**
   * Get authorization headers
   * @returns {Object} Headers object with client_id and Authorization
   */
  getAuthHeaders() {
    return {
      ...this.getBaseHeaders(),
      ...(this.token && { 'Authorization': `Bearer ${this.token}` })
    };
  },

  /**
   * Authenticate user against G4U API
   * @param {Object} credentials - { email, password }
   * @returns {Promise<Object>} - { token, user }
   */
  async login(credentials) {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: this.getBaseHeaders(),
      body: JSON.stringify({ email: credentials.email, password: credentials.password })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Login failed' }));
      throw new Error(error.message || 'Invalid credentials');
    }

    const data = await response.json();
    // Use access_token from API response
    const token = data.access_token || data.token || data.accessToken;
    console.log('Login response:', data);
    console.log('Extracted token:', token ? token.substring(0, 50) + '...' : 'none');
    
    if (!token) {
      console.error('No token found in login response:', data);
      throw new Error('Login failed: No token received');
    }
    
    this.setToken(token);
    this.setUserEmail(credentials.email);
    return data;
  },

  /**
   * Fetch tasks by status from user-action/search endpoint
   * @param {string} status - Task status (PENDING, DONE, DELIVERED)
   * @returns {Promise<Array>} - Array of task objects
   */
  async getTasksByStatus(status) {
    const params = new URLSearchParams({
      user_email: this.userEmail,
      STATUS: status,
      use_pagination: 'false'
    });

    const response = await fetch(`${API_BASE_URL}/user-action/search?${params}`, {
      method: 'GET',
      headers: this.getAuthHeaders()
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('SESSION_EXPIRED');
      }
      const error = await response.json().catch(() => ({ message: 'Failed to fetch tasks' }));
      throw new Error(error.message || 'Failed to fetch tasks');
    }

    const data = await response.json();
    return data.tasks || data.data || data || [];
  },

  /**
   * Fetch user's tasks from G4U API (PENDING + DONE/DELIVERED)
   * @returns {Promise<Array>} - Array of task objects with isCompleted flag
   */
  async getTasks() {
    // Fetch PENDING tasks (active)
    const pendingTasks = await this.getTasksByStatus('PENDING');
    
    // Fetch DONE tasks (completed)
    const doneTasks = await this.getTasksByStatus('DONE');
    
    // Fetch DELIVERED tasks (also completed)
    const deliveredTasks = await this.getTasksByStatus('DELIVERED');

    // Map tasks to include isCompleted flag
    const activeTasks = (Array.isArray(pendingTasks) ? pendingTasks : []).map(task => ({
      ...task,
      isCompleted: false
    }));

    const completedTasks = [
      ...(Array.isArray(doneTasks) ? doneTasks : []),
      ...(Array.isArray(deliveredTasks) ? deliveredTasks : [])
    ].map(task => ({
      ...task,
      isCompleted: true
    }));

    return [...activeTasks, ...completedTasks];
  },

  /**
   * Update task execution count
   * @param {string} taskId - Task ID
   * @param {number} executionCount - New execution count
   * @returns {Promise<Object>} - Updated task
   */
  async updateTaskExecution(taskId, executionCount) {
    const response = await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ executionCount })
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('SESSION_EXPIRED');
      }
      const error = await response.json().catch(() => ({ message: 'Failed to update task' }));
      throw new Error(error.message || 'Failed to update task');
    }

    return response.json();
  },

  /**
   * Mark task as complete
   * @param {string} taskId - Task ID
   * @returns {Promise<Object>} - Updated task
   */
  async markTaskComplete(taskId) {
    const response = await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ isCompleted: true })
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('SESSION_EXPIRED');
      }
      const error = await response.json().catch(() => ({ message: 'Failed to complete task' }));
      throw new Error(error.message || 'Failed to complete task');
    }

    return response.json();
  }
};
