/**
 * Unit tests for auth service
 */
import { authService } from '../../src/services/auth';
import { apiClient } from '../../src/services/api';
import { storage } from '../../src/services/storage';

jest.mock('../../src/services/api');
jest.mock('../../src/services/storage');

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('signup', () => {
    it('should successfully sign up a new user', async () => {
      const mockResponse = {
        userId: 'test-user-id',
        email: 'test@example.com',
        message: 'Account created'
      };

      (apiClient.post as jest.Mock).mockResolvedValue(mockResponse);

      const result = await authService.signup({
        email: 'test@example.com',
        password: 'password123',
        displayName: 'Test User'
      });

      expect(result).toEqual(mockResponse);
      expect(apiClient.post).toHaveBeenCalledWith('/auth/signup', {
        email: 'test@example.com',
        password: 'password123',
        displayName: 'Test User'
      });
    });

    it('should handle signup errors', async () => {
      const error = new Error('Email already registered');
      (apiClient.post as jest.Mock).mockRejectedValue(error);

      await expect(
        authService.signup({
          email: 'test@example.com',
          password: 'password123',
          displayName: 'Test User'
        })
      ).rejects.toThrow('Email already registered');
    });
  });

  describe('login', () => {
    it('should successfully login and store token', async () => {
      const mockResponse = {
        token: 'test-jwt-token',
        user: {
          userId: 'test-user-id',
          email: 'test@example.com',
          userType: 'parent'
        },
        familyId: 'test-family-id'
      };

      (apiClient.post as jest.Mock).mockResolvedValue(mockResponse);
      (storage.setToken as jest.Mock).mockResolvedValue(undefined);
      (storage.setUser as jest.Mock).mockResolvedValue(undefined);
      (storage.setFamilyId as jest.Mock).mockResolvedValue(undefined);

      const result = await authService.login({
        email: 'test@example.com',
        password: 'password123'
      });

      expect(result).toEqual(mockResponse);
      expect(storage.setToken).toHaveBeenCalledWith('test-jwt-token');
      expect(storage.setUser).toHaveBeenCalledWith(mockResponse.user);
    });

    it('should handle login errors', async () => {
      const error = new Error('Invalid credentials');
      (apiClient.post as jest.Mock).mockRejectedValue(error);

      await expect(
        authService.login({
          email: 'test@example.com',
          password: 'wrongpassword'
        })
      ).rejects.toThrow('Invalid credentials');
    });
  });

  describe('verifyEmail', () => {
    it('should successfully verify email', async () => {
      (apiClient.post as jest.Mock).mockResolvedValue({});

      await authService.verifyEmail('test-token');

      expect(apiClient.post).toHaveBeenCalledWith('/auth/verify-email', {
        token: 'test-token'
      });
    });
  });

  describe('createFamily', () => {
    it('should successfully create a family', async () => {
      const mockResponse = {
        message: 'Family created',
        family: {
          familyId: 'test-family-id',
          familyName: 'Test Family',
          currency: 'CAD',
          timezone: 'America/Toronto'
        }
      };

      (apiClient.post as jest.Mock).mockResolvedValue(mockResponse);
      (storage.setFamilyId as jest.Mock).mockResolvedValue(undefined);

      // Mock useAuthStore.getState() to return an object with token and user
      const { useAuthStore } = require('../../src/store');
      (useAuthStore.getState as jest.Mock).mockReturnValue({
        token: 'test-token',
        user: { userId: 'test-user-id' },
        setAuth: jest.fn(),
      });

      const result = await authService.createFamily({
        familyName: 'Test Family',
        currency: 'CAD',
        timezone: 'America/Toronto'
      });

      expect(result.familyId).toBe('test-family-id');
      expect(result.familyName).toBe('Test Family');
      expect(storage.setFamilyId).toHaveBeenCalledWith('test-family-id');
    });
  });

  describe('loginChild', () => {
    it('should successfully login as child', async () => {
      const mockResponse = {
        token: 'test-jwt-token',
        user: {
          userId: 'child-user-id',
          username: 'alice',
          userType: 'child'
        },
        familyId: 'test-family-id'
      };

      (apiClient.post as jest.Mock).mockResolvedValue(mockResponse);
      (storage.setToken as jest.Mock).mockResolvedValue(undefined);
      (storage.setUser as jest.Mock).mockResolvedValue(undefined);
      (storage.setFamilyId as jest.Mock).mockResolvedValue(undefined);

      const result = await authService.loginChild({
        username: 'alice',
        password: 'password123'
      });

      expect(result).toEqual(mockResponse);
      expect(storage.setToken).toHaveBeenCalledWith('test-jwt-token');
    });
  });
});
