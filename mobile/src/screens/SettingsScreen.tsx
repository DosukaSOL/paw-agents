// ─── PAW Mobile — Settings Screen ───

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
} from 'react-native';

export function SettingsScreen(): React.JSX.Element {
  const [gatewayUrl, setGatewayUrl] = useState('ws://127.0.0.1:18789');
  const [authToken, setAuthToken] = useState('');
  const [darkMode, setDarkMode] = useState(true);
  const [notifications, setNotifications] = useState(true);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.sectionTitle}>Connection</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Gateway URL</Text>
        <TextInput
          style={styles.input}
          value={gatewayUrl}
          onChangeText={setGatewayUrl}
          placeholder="ws://127.0.0.1:18789"
          placeholderTextColor="#666"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.label}>Auth Token</Text>
        <TextInput
          style={styles.input}
          value={authToken}
          onChangeText={setAuthToken}
          placeholder="Optional"
          placeholderTextColor="#666"
          secureTextEntry
          autoCapitalize="none"
        />
      </View>

      <Text style={styles.sectionTitle}>Preferences</Text>
      <View style={styles.card}>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Dark Mode</Text>
          <Switch
            value={darkMode}
            onValueChange={setDarkMode}
            trackColor={{ true: '#7c3aed', false: '#333' }}
          />
        </View>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Notifications</Text>
          <Switch
            value={notifications}
            onValueChange={setNotifications}
            trackColor={{ true: '#7c3aed', false: '#333' }}
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>About</Text>
      <View style={styles.card}>
        <Text style={styles.aboutText}>PAW Agents Mobile v3.2.0</Text>
        <Text style={styles.aboutSubtext}>Programmable Autonomous Workers</Text>
        <Text style={styles.aboutSubtext}>The operating system for autonomous AI agents.</Text>
      </View>

      <TouchableOpacity style={styles.saveButton}>
        <Text style={styles.saveButtonText}>Save Settings</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#08080d',
    padding: 16,
  },
  sectionTitle: {
    color: '#a8a4b8',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: '#13131f',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.2)',
  },
  label: {
    color: '#a8a4b8',
    fontSize: 13,
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    backgroundColor: '#08080d',
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.2)',
    borderRadius: 8,
    padding: 12,
    color: '#f0eef5',
    fontSize: 15,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  settingLabel: {
    color: '#f0eef5',
    fontSize: 15,
  },
  aboutText: {
    color: '#f0eef5',
    fontSize: 15,
    fontWeight: '600',
  },
  aboutSubtext: {
    color: '#a8a4b8',
    fontSize: 13,
    marginTop: 4,
  },
  saveButton: {
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 40,
  },
  saveButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
});
