// ─── PAW Mobile — App Entry Point ───
// React Native app with navigation between Chat and Settings screens.

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ChatScreen } from './src/screens/ChatScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';

export type RootStackParamList = {
  Chat: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App(): React.JSX.Element {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Chat"
        screenOptions={{
          headerStyle: { backgroundColor: '#0f0f23' },
          headerTintColor: '#e0e0e8',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: '#0f0f23' },
        }}
      >
        <Stack.Screen
          name="Chat"
          component={ChatScreen}
          options={{ title: '🐾 PAW Agents' }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ title: 'Settings' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
