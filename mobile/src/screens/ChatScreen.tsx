// ─── PAW Mobile — Chat Screen ───

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { PawClient, PawMessage, ConnectionStatus } from '../services/PawClient';

interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
  timestamp: string;
}

export function ChatScreen(): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'agent',
      text: '🐾 Welcome to PAW Agents! Type a message to get started.',
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const clientRef = useRef<PawClient | null>(null);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    const client = new PawClient();
    clientRef.current = client;

    client.onStatusChange(setStatus);

    client.onMessage((msg: PawMessage) => {
      const text = msg.payload?.text ?? JSON.stringify(msg.payload);
      setMessages(prev => [...prev, {
        id: `agent_${Date.now()}`,
        role: 'agent',
        text,
        timestamp: msg.timestamp,
      }]);
    });

    client.connect();

    return () => {
      client.disconnect();
    };
  }, []);

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text || !clientRef.current?.isConnected()) return;

    setMessages(prev => [...prev, {
      id: `user_${Date.now()}`,
      role: 'user',
      text,
      timestamp: new Date().toISOString(),
    }]);

    try {
      clientRef.current.sendMessage(text);
    } catch {
      setMessages(prev => [...prev, {
        id: `error_${Date.now()}`,
        role: 'agent',
        text: 'Failed to send. Check your connection.',
        timestamp: new Date().toISOString(),
      }]);
    }

    setInput('');
  }, [input]);

  const renderMessage = ({ item }: { item: ChatMessage }) => (
    <View style={[styles.messageBubble, item.role === 'user' ? styles.userBubble : styles.agentBubble]}>
      <Text style={styles.messageText}>{item.text}</Text>
    </View>
  );

  const statusColor = status === 'connected' ? '#22c55e' : status === 'connecting' ? '#eab308' : '#ef4444';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={styles.statusBar}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <Text style={styles.statusText}>{status}</Text>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        style={styles.chatList}
        contentContainerStyle={styles.chatContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
      />

      <View style={styles.inputArea}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Message PAW..."
          placeholderTextColor="#666"
          onSubmitEditing={sendMessage}
          returnKeyType="send"
        />
        <TouchableOpacity
          style={[styles.sendButton, !input.trim() && styles.sendButtonDisabled]}
          onPress={sendMessage}
          disabled={!input.trim()}
        >
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f23',
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a3e',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    color: '#8888aa',
    fontSize: 12,
    textTransform: 'capitalize',
  },
  chatList: {
    flex: 1,
  },
  chatContent: {
    padding: 16,
    paddingBottom: 8,
  },
  messageBubble: {
    maxWidth: '80%',
    marginBottom: 12,
    padding: 12,
    borderRadius: 16,
  },
  userBubble: {
    backgroundColor: '#3b3b8f',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  agentBubble: {
    backgroundColor: '#1a1a3e',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#2a2a5e',
  },
  messageText: {
    color: '#e0e0e8',
    fontSize: 15,
    lineHeight: 22,
  },
  inputArea: {
    flexDirection: 'row',
    padding: 12,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#1a1a3e',
    backgroundColor: '#0a0a1a',
  },
  input: {
    flex: 1,
    backgroundColor: '#1a1a3e',
    borderWidth: 1,
    borderColor: '#2a2a5e',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#e0e0e8',
    fontSize: 15,
  },
  sendButton: {
    backgroundColor: '#6366f1',
    borderRadius: 12,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 15,
  },
});
