/**
 * React Navigation configuration for Passbook app
 */
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { RootStackParamList } from '../types';
import { useAuthStore } from '../store';

// Import screens
import { LoginScreen } from '../screens/SharedScreens/LoginScreen';
import { SignupScreen } from '../screens/SharedScreens/SignupScreen';
import { EmailVerificationScreen } from '../screens/SharedScreens/EmailVerificationScreen';
import { FamilySetupScreen } from '../screens/ParentScreens/FamilySetupScreen';
import { ChildManagementScreen } from '../screens/ParentScreens/ChildManagementScreen';
import { AddFundsScreen } from '../screens/ParentScreens/AddFundsScreen';
import { ChildDashboardScreen } from '../screens/ChildScreens/ChildDashboard';
import { AddExpenseScreen } from '../screens/ChildScreens/AddExpenseScreen';
import { ExpenseListScreen } from '../screens/ChildScreens/ExpenseListScreen';
import { ParentManagementScreen } from '../screens/ParentScreens/ParentManagementScreen';
import { PasswordResetScreen } from '../screens/SharedScreens/PasswordResetScreen';
import { AnalyticsScreen } from '../screens/SharedScreens/AnalyticsScreen';
import { NotificationSettingsScreen } from '../screens/SharedScreens/NotificationSettings';

// Placeholder screens (will be implemented in later user stories)
const ParentDashboardScreen = () => null;
const SettingsScreen = () => null;

const Stack = createStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();

/**
 * Main navigation stack
 */
function MainStack() {
  const { isAuthenticated, user } = useAuthStore();

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: '#fff',
        },
        headerTintColor: '#000',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      }}
    >
      {!isAuthenticated ? (
        // Auth screens
        <>
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ title: 'Login' }}
          />
          <Stack.Screen
            name="Signup"
            component={SignupScreen}
            options={{ title: 'Sign Up' }}
          />
          <Stack.Screen
            name="PasswordReset"
            component={PasswordResetScreen}
            options={{ title: 'Reset Password' }}
          />
          <Stack.Screen
            name="EmailVerification"
            component={EmailVerificationScreen}
            options={{ title: 'Verify Email' }}
            initialParams={{ token: '' }}
          />
        </>
      ) : user?.userType === 'parent' ? (
        // Parent screens
        <>
          <Stack.Screen
            name="FamilySetup"
            component={FamilySetupScreen}
            options={{ title: 'Family Setup' }}
          />
          <Stack.Screen
            name="ParentDashboard"
            component={ParentDashboardScreen}
            options={{ title: 'Dashboard' }}
          />
          <Stack.Screen
            name="ChildManagement"
            component={ChildManagementScreen}
            options={{ title: 'Manage Children' }}
          />
          <Stack.Screen
            name="AddFunds"
            component={AddFundsScreen}
            options={{ title: 'Add Funds' }}
          />
          <Stack.Screen
            name="ParentManagement"
            component={ParentManagementScreen}
            options={{ title: 'Manage Parents' }}
          />
          <Stack.Screen
            name="Analytics"
            component={AnalyticsScreen}
            options={{ title: 'Analytics' }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ title: 'Settings' }}
          />
        </>
      ) : (
        // Child screens
        <>
          <Stack.Screen
            name="ChildDashboard"
            component={ChildDashboardScreen}
            options={{ title: 'My Passbook' }}
          />
          <Stack.Screen
            name="AddExpense"
            component={AddExpenseScreen}
            options={{ title: 'Add Expense' }}
          />
          <Stack.Screen
            name="ExpenseList"
            component={ExpenseListScreen}
            options={{ title: 'Expenses' }}
          />
          <Stack.Screen
            name="Analytics"
            component={AnalyticsScreen}
            options={{ title: 'Analytics' }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ title: 'Settings' }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}

/**
 * Root navigation container
 */
export function AppNavigator() {
  return (
    <NavigationContainer>
      <MainStack />
    </NavigationContainer>
  );
}
