/**
 * Unit Tests for API Client Module
 * Tests login success/failure scenarios and task operations
 * Requirements: 1.1, 1.2, 2.1, 3.3
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiClient, API_BASE_URL } from '../../api-client.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('ApiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ApiClient.token = null;
  });

  describe('login', () => {
    it('should return token and user on successful login and store email (Requirement 1.1)', async () => {
      const mockResponse = {
        token: 'test-jwt-token',
        user: { id: '123', name: 'Test User' }
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await ApiClient.login({ email: 'test@example.com', password: 'password123' });

      expect(result).toEqual(mockResponse);
      expect(ApiClient.token).toBe('test-jwt-token');
      expect(ApiClient.userEmail).toBe('test@example.com');
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/auth/login`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'client_id': 'healthgo' },
          body: JSON.stringify({ email: 'test@example.com', password: 'password123' })
        }
      );
    });

    it('should throw error on invalid credentials (Requirement 1.2)', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ message: 'Invalid credentials' })
      });

      await expect(
        ApiClient.login({ email: 'wrong@example.com', password: 'wrongpass' })
      ).rejects.toThrow('Invalid credentials');
      
      expect(ApiClient.token).toBeNull();
    });

    it('should throw default error when API returns non-JSON error', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.reject(new Error('Not JSON'))
      });

      await expect(
        ApiClient.login({ email: 'test@example.com', password: 'password' })
      ).rejects.toThrow('Login failed');
    });
  });

  describe('getTasksByStatus', () => {
    beforeEach(() => {
      ApiClient.token = 'valid-token';
      ApiClient.userEmail = 'test@example.com';
    });

    it('should fetch tasks by status with correct parameters', async () => {
      const mockTasks = [
        { id: '1', name: 'Task 1', executionCount: 0, targetCount: 5 }
      ];

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ tasks: mockTasks })
      });

      const result = await ApiClient.getTasksByStatus('PENDING');

      expect(result).toEqual(mockTasks);
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/user-action/search?user_email=test%40example.com&status=PENDING&use_pagination=false`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'client_id': 'healthgo',
            'Authorization': 'Bearer valid-token'
          }
        }
      );
    });

    it('should throw SESSION_EXPIRED on 401 response', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: 'Unauthorized' })
      });

      await expect(ApiClient.getTasksByStatus('PENDING')).rejects.toThrow('SESSION_EXPIRED');
    });
  });

  describe('getTasks', () => {
    beforeEach(() => {
      ApiClient.token = 'valid-token';
      ApiClient.userEmail = 'test@example.com';
    });

    it('should fetch PENDING, DOING, and DONE tasks and combine them (Requirements 3.1, 3.5)', async () => {
      const now = new Date();
      const todayISO = now.toISOString();
      const pendingTasks = [{ id: '1', action_template_id: '1', action_title: 'Pending Task', status: 'PENDING', comments: [] }];
      const doingTasks = [{ id: '2', action_template_id: '2', action_title: 'Doing Task', status: 'DOING', comments: [] }];
      const doneTasks = [{ id: '3', action_template_id: '3', action_title: 'Done Task', status: 'DONE', finished_at: todayISO, comments: [] }];

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ tasks: pendingTasks }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ tasks: doingTasks }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ tasks: doneTasks }) });

      const result = await ApiClient.getTasks();

      expect(result).toHaveLength(3);
      expect(result.find(t => t.name === 'Pending Task')).toBeDefined();
      expect(result.find(t => t.name === 'Doing Task')).toBeDefined();
      expect(result.find(t => t.name === 'Done Task')).toBeDefined();
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('should handle empty task arrays', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ tasks: [] }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ tasks: [] }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ tasks: [] }) });

      const result = await ApiClient.getTasks();
      expect(result).toEqual([]);
    });

    it('should throw error if any status fetch fails', async () => {
      global.fetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ message: 'Server error' })
        })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ tasks: [] }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ tasks: [] }) });

      await expect(ApiClient.getTasks()).rejects.toThrow('Server error');
    });
  });

  describe('markTaskComplete', () => {
    beforeEach(() => {
      ApiClient.token = 'valid-token';
    });

    it('should mark task as complete (Requirement 4.2)', async () => {
      const mockCompletedTask = {
        id: 'task-1',
        name: 'Test Task',
        executionCount: 10,
        targetCount: 10,
        isCompleted: true
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockCompletedTask)
      });

      const result = await ApiClient.markTaskComplete('task-1');

      expect(result).toEqual(mockCompletedTask);
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/tasks/task-1`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'client_id': 'healthgo',
            'Authorization': 'Bearer valid-token'
          },
          body: JSON.stringify({ isCompleted: true })
        }
      );
    });

    it('should throw SESSION_EXPIRED on 401 response', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: 'Unauthorized' })
      });

      await expect(ApiClient.markTaskComplete('task-1')).rejects.toThrow('SESSION_EXPIRED');
    });

    it('should throw error on completion failure', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ message: 'Task not found' })
      });

      await expect(ApiClient.markTaskComplete('invalid-id')).rejects.toThrow('Task not found');
    });
  });

  describe('getUserData', () => {
    beforeEach(() => {
      vi.resetAllMocks();
      global.fetch = vi.fn();
      ApiClient.token = 'valid-token';
    });

    it('should fetch user data with correct URL and headers (Requirement 6.1)', async () => {
      const mockUserData = {
        user_id: 'user-123',
        full_name: 'Test User',
        locked_points: 50,
        unlocked_points: 100
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockUserData)
      });

      const result = await ApiClient.getUserData('user-123');

      expect(result).toEqual(mockUserData);
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/user/user-123`,
        {
          method: 'GET',
          headers: ApiClient.getAuthHeaders()
        }
      );
    });

    it('should throw SESSION_EXPIRED on 401 response (Requirement 6.4)', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: 'Unauthorized' })
      });

      await expect(ApiClient.getUserData('user-123')).rejects.toThrow('SESSION_EXPIRED');
    });

    it('should return zero points on 404 response (Requirement 6.5)', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ message: 'User not found' })
      });

      const result = await ApiClient.getUserData('nonexistent-user');

      expect(result).toEqual({ locked_points: 0, unlocked_points: 0 });
    });

    it('should throw error on other failure statuses', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: 'Internal server error' })
      });

      await expect(ApiClient.getUserData('user-123')).rejects.toThrow('Internal server error');
    });

    it('should throw default error when API returns non-JSON error', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('Not JSON'))
      });

      await expect(ApiClient.getUserData('user-123')).rejects.toThrow('Failed to fetch user data');
    });
  });

  describe('getBaseHeaders', () => {
    it('should return headers with client_id', () => {
      const headers = ApiClient.getBaseHeaders();
      
      expect(headers).toEqual({ 
        'Content-Type': 'application/json',
        'client_id': 'healthgo'
      });
    });
  });

  describe('getAuthHeaders', () => {
    it('should return headers with client_id but without Authorization when no token', () => {
      ApiClient.token = null;
      const headers = ApiClient.getAuthHeaders();
      
      expect(headers).toEqual({ 
        'Content-Type': 'application/json',
        'client_id': 'healthgo'
      });
      expect(headers.Authorization).toBeUndefined();
    });

    it('should return headers with client_id and Authorization when token is set', () => {
      ApiClient.token = 'my-token';
      const headers = ApiClient.getAuthHeaders();
      
      expect(headers).toEqual({
        'Content-Type': 'application/json',
        'client_id': 'healthgo',
        'Authorization': 'Bearer my-token'
      });
    });
  });
});
