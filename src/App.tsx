// ============================================================
// GroundPin — App Root Component
// ============================================================
//
// Sets up React Navigation with a native stack navigator.
// Two screens: MainScreen (home) and AttachmentsScreen (attachment list).
// ============================================================

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'react-native';
import MainScreen from './screens/MainScreen';
import AttachmentsScreen from './screens/AttachmentsScreen';

const Stack = createNativeStackNavigator();

const screenOptions = {
  headerStyle: {
    backgroundColor: '#16213e',
  },
  headerTintColor: '#ffffff',
  headerTitleStyle: {
    fontWeight: '600' as const,
  },
  contentStyle: {
    backgroundColor: '#1a1a2e',
  },
};

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar barStyle="light-content" backgroundColor="#16213e" />
      <Stack.Navigator screenOptions={screenOptions}>
        <Stack.Screen
          name="Main"
          component={MainScreen}
          options={{ title: 'GroundPin', headerShown: false }}
        />
        <Stack.Screen
          name="Attachments"
          component={AttachmentsScreen}
          options={{ title: '附件列表' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
