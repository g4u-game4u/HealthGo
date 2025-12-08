/**
 * API Client Module
 * Handles all communication with the G4U API
 */

export const API_BASE_URL = 'https://g4u-mvp-api.onrender.com';

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
      'client_id': 'healthgo'
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
      status: status,
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
   * Aggregate tasks by action_template_id
   * Groups tasks with same template, counts completed vs total
   * @param {Array} allTasks - All raw tasks from API
   * @returns {Array} - Aggregated task objects
   */
  aggregateTasks(allTasks) {
    const grouped = {};
    
    allTasks.forEach(task => {
      const templateId = task.action_template_id || task.id;
      
      if (!grouped[templateId]) {
        grouped[templateId] = {
          id: templateId,
          name: task.action_title || 'Unnamed Task',
          teamName: task.team_name,
          tasks: [],
          executionCount: 0,
          targetCount: 0
        };
      }
      
      grouped[templateId].tasks.push(task);
      grouped[templateId].targetCount++;
      
      // Count completed tasks (DONE or DELIVERED)
      if (task.status === 'DONE' || task.status === 'DELIVERED') {
        grouped[templateId].executionCount++;
      }
    });
    
    // Convert to array and determine if fully completed
    return Object.values(grouped).map(group => ({
      ...group,
      isCompleted: group.executionCount === group.targetCount && group.targetCount > 0
    }));
  },

  /**
   * Fetch user's tasks from G4U API (PENDING + DONE/DELIVERED)
   * @returns {Promise<Array>} - Array of aggregated task objects
   */
  async getTasks() {
    // Fetch all task statuses
    const [pendingTasks, doneTasks, deliveredTasks] = await Promise.all([
      this.getTasksByStatus('PENDING'),
      this.getTasksByStatus('DONE'),
      this.getTasksByStatus('DELIVERED')
    ]);

    // Combine all tasks
    const allTasks = [
      ...(Array.isArray(pendingTasks) ? pendingTasks : []),
      ...(Array.isArray(doneTasks) ? doneTasks : []),
      ...(Array.isArray(deliveredTasks) ? deliveredTasks : [])
    ];

    // Aggregate by action_template_id
    return this.aggregateTasks(allTasks);
  },

  /**
   * Update task status via game/action/process endpoint
   * @param {Object} task - Raw task object from API (not aggregated)
   * @param {string} newStatus - New status (PENDING, DONE, DELIVERED)
   * @returns {Promise<Object>} - Updated task
   */
  async updateTaskStatus(task, newStatus) {
    // Build payload with only the required fields, action_id = action_template_id
    const payload = {
      action_id: task.action_template_id,
      approved: task.approved || false,
      approved_by: task.approved_by || null,
      comments: task.comments || [],
      created_at: task.created_at,
      delivery_id: task.delivery_id,
      delivery_title: task.delivery_title,
      dismissed: task.dismissed || false,
      finished_at: newStatus === 'DONE' ? new Date().toISOString() : null,
      integration_id: task.integration_id,
      status: newStatus,
      user_email: task.user_email
    };
    
    console.log('Updating task status:', { actionId: task.action_template_id, newStatus, payload });
    
    const response = await fetch(`${API_BASE_URL}/game/action/process`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(payload)
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
   * Mark the oldest PENDING task in a group as DONE
   * @param {Object} aggregatedTask - Aggregated task with tasks array
   * @returns {Promise<Object>} - Updated task
   */
  async markOldestPendingAsDone(aggregatedTask) {
    // Find oldest PENDING task (sort by created_at ascending)
    const pendingTasks = aggregatedTask.tasks
      .filter(t => t.status === 'PENDING')
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    
    if (pendingTasks.length === 0) {
      throw new Error('No pending tasks to complete');
    }
    
    return this.updateTaskStatus(pendingTasks[0], 'DONE');
  },

  /**
   * Reopen the newest DONE task in a group (set to PENDING)
   * @param {Object} aggregatedTask - Aggregated task with tasks array
   * @returns {Promise<Object>} - Updated task
   */
  async reopenNewestDoneTask(aggregatedTask) {
    // Find newest DONE task (sort by created_at descending)
    const doneTasks = aggregatedTask.tasks
      .filter(t => t.status === 'DONE')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    if (doneTasks.length === 0) {
      throw new Error('No done tasks to reopen');
    }
    
    return this.updateTaskStatus(doneTasks[0], 'PENDING');
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
