/**
 * Authentication service for signup, login, and email verification
 */
import { apiClient } from './api';
import { storage } from './storage';
import { useAuthStore } from '../store';
import { AuthResponse, LoginRequest, SignupRequest } from '../types';

class AuthService {
  /**
   * Sign up a new parent account
   */
  async signup(data: SignupRequest): Promise<{ userId: string; email: string }> {
    const response = await apiClient.post<{ userId: string; email: string; message: string }>(
      '/auth/signup',
      data
    );
    return response;
  }

  /**
   * Verify email with token
   */
  async verifyEmail(token: string): Promise<void> {
    await apiClient.post('/auth/verify-email', { token });
  }

  /**
   * Login with email/password or username/password
   */
  async login(credentials: LoginRequest): Promise<AuthResponse> {
    const response = await apiClient.post<AuthResponse>('/auth/login', credentials);

    // Store auth data
    await storage.setToken(response.token);
    await storage.setUser(response.user);
    if (response.familyId) {
      await storage.setFamilyId(response.familyId);
    }

    // Update store
    useAuthStore.getState().setAuth(
      response.token,
      response.user,
      response.familyId
    );

    return response;
  }

  /**
   * Login as child (username/password or email/password)
   */
  async loginChild(credentials: LoginRequest): Promise<AuthResponse> {
    // Child login uses the same endpoint but with username
    const response = await apiClient.post<AuthResponse>('/auth/login', credentials);

    // Store auth data
    await storage.setToken(response.token);
    await storage.setUser(response.user);
    if (response.familyId) {
      await storage.setFamilyId(response.familyId);
    }

    // Update store
    useAuthStore.getState().setAuth(
      response.token,
      response.user,
      response.familyId
    );

    return response;
  }

  /**
   * Logout current user
   */
  async logout(): Promise<void> {
    await storage.clear();
    useAuthStore.getState().clearAuth();
  }

  /**
   * Check if user is authenticated
   */
  async checkAuth(): Promise<boolean> {
    const token = await storage.getToken();
    const user = await storage.getUser();

    if (token && user) {
      useAuthStore.getState().setAuth(
        token,
        user,
        await storage.getFamilyId()
      );
      return true;
    }

    return false;
  }

  /**
   * Create a family account
   */
  async createFamily(data: {
    familyName: string;
    currency?: string;
    timezone?: string;
    description?: string;
  }): Promise<{ familyId: string; familyName: string }> {
    const response = await apiClient.post<{
      message: string;
      family: { familyId: string; familyName: string; currency: string; timezone: string };
    }>('/accounts/families', data);

    // Update store with family ID
    if (response.family.familyId) {
      await storage.setFamilyId(response.family.familyId);
      useAuthStore.getState().setAuth(
        useAuthStore.getState().token!,
        useAuthStore.getState().user!,
        response.family.familyId
      );
    }

    return {
      familyId: response.family.familyId,
      familyName: response.family.familyName,
    };
  }
}

export const authService = new AuthService();
