import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';

export default function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      setMessage('❌ Please enter email and password');
      return;
    }

    setLoading(true);
    setMessage('Logging in...');
    
    try {
      const API_URL = 'https://afbtrc48hc.execute-api.us-west-2.amazonaws.com/development';
      
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();
      
      if (response.ok) {
        setMessage(`✅ Login successful! Welcome ${data.user?.displayName || 'User'}`);
      } else {
        setMessage(`❌ ${data.error || 'Login failed'}`);
      }
    } catch (error) {
      setMessage(`❌ Network error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>🏦 Passbook</Text>
        <Text style={styles.subtitle}>Family Allowance Manager</Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            editable={!loading}
          />

          <TextInput
            style={styles.input}
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            editable={!loading}
          />

          <TouchableOpacity 
            style={[styles.button, loading && styles.buttonDisabled]} 
            onPress={handleLogin}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? 'Logging in...' : 'Login'}
            </Text>
          </TouchableOpacity>

          {message ? (
            <View style={styles.messageBox}>
              <Text style={styles.message}>{message}</Text>
            </View>
          ) : null}

          <View style={styles.info}>
            <Text style={styles.infoTitle}>Test Account:</Text>
            <Text style={styles.infoText}>Email: support@embeddedinn.com</Text>
            <Text style={styles.infoText}>Password: Passbook2025!</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Backend: AWS Lambda + DynamoDB</Text>
          <Text style={styles.footerText}>Frontend: GitHub Pages</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: '#666',
    marginBottom: 48,
  },
  form: {
    width: '100%',
    maxWidth: 400,
  },
  input: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 14,
    marginBottom: 16,
    fontSize: 16,
    outlineStyle: 'none',
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: '#999',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  messageBox: {
    marginTop: 20,
    padding: 14,
    backgroundColor: 'white',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  message: {
    fontSize: 15,
    textAlign: 'center',
    color: '#333',
  },
  info: {
    marginTop: 32,
    padding: 16,
    backgroundColor: '#e3f2fd',
    borderRadius: 8,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1976d2',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#1976d2',
    marginBottom: 4,
  },
  footer: {
    marginTop: 40,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
});
