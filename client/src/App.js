import React, { useState, useEffect } from 'react';
import './App.css';

const API_BASE_URL = 'http://localhost:5000/api';

function App() {
  const [systemStatus, setSystemStatus] = useState({
    status: 'checking',
    ragInitialized: false,
    isInitializing: false,
    error: null
  });
  
  const [beforeRagInput, setBeforeRagInput] = useState('');
  const [withRagInput, setWithRagInput] = useState('');
  const [responses, setResponses] = useState({
    beforeRag: null,
    withRag: null
  });
  const [loading, setLoading] = useState({
    beforeRag: false,
    withRag: false,
    initializing: false
  });

  // Check system status
  const checkStatus = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      const data = await response.json();
      setSystemStatus({
        status: 'online',
        ragInitialized: data.ragInitialized,
        isInitializing: data.isInitializing,
        error: data.initializationError
      });
    } catch (error) {
      setSystemStatus({
        status: 'offline',
        ragInitialized: false,
        isInitializing: false,
        error: 'Cannot connect to backend server'
      });
    }
  };

  // Initialize RAG system
  const initializeRAG = async () => {
    setLoading(prev => ({ ...prev, initializing: true }));
    try {
      const response = await fetch(`${API_BASE_URL}/initialize`, {
        method: 'POST',
      });
      const data = await response.json();
      
      if (data.success) {
        await checkStatus(); // Refresh status
      } else {
        setSystemStatus(prev => ({ ...prev, error: data.error }));
      }
    } catch (error) {
      setSystemStatus(prev => ({ ...prev, error: 'Failed to initialize RAG system' }));
    } finally {
      setLoading(prev => ({ ...prev, initializing: false }));
    }
  };

  // Chat without RAG
  const chatBeforeRAG = async () => {
    if (!beforeRagInput.trim()) return;

    setLoading(prev => ({ ...prev, beforeRag: true }));
    try {
      const response = await fetch(`${API_BASE_URL}/chat/before-rag`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ topic: beforeRagInput }),
      });

      const data = await response.json();
      
      if (response.ok) {
        setResponses(prev => ({ ...prev, beforeRag: data }));
      } else {
        setResponses(prev => ({ 
          ...prev, 
          beforeRag: { error: data.error || 'An error occurred' }
        }));
      }
    } catch (error) {
      setResponses(prev => ({ 
        ...prev, 
        beforeRag: { error: 'Network error: ' + error.message }
      }));
    } finally {
      setLoading(prev => ({ ...prev, beforeRag: false }));
    }
  };

  // Chat with RAG
  const chatWithRAG = async () => {
    if (!withRagInput.trim()) return;

    setLoading(prev => ({ ...prev, withRag: true }));
    try {
      const response = await fetch(`${API_BASE_URL}/chat/with-rag`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question: withRagInput }),
      });

      const data = await response.json();
      
      if (response.ok) {
        setResponses(prev => ({ ...prev, withRag: data }));
      } else {
        setResponses(prev => ({ 
          ...prev, 
          withRag: { error: data.error || 'An error occurred' }
        }));
      }
    } catch (error) {
      setResponses(prev => ({ 
        ...prev, 
        withRag: { error: 'Network error: ' + error.message }
      }));
    } finally {
      setLoading(prev => ({ ...prev, withRag: false }));
    }
  };

  // Handle Enter key press
  const handleKeyPress = (event, action) => {
    if (event.key === 'Enter') {
      action();
    }
  };

  // Check status on component mount and periodically
  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000); // Check every 5 seconds
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="App">
      <header className="App-header">
        <h1>🤖 Karl Chat</h1>
        <p>RAG-powered chatbot using LangChain, Neo4j, and Ollama</p>
      </header>

      {/* System Status */}
      <div className={`status-card ${systemStatus.status}`}>
        <div className="status-indicator">
          {systemStatus.status === 'online' ? '🟢' : 
           systemStatus.status === 'checking' ? '🟡' : '🔴'}
        </div>
        <div className="status-text">
          {systemStatus.status === 'checking' && 'Checking system status...'}
          {systemStatus.status === 'offline' && 'Backend server offline'}
          {systemStatus.status === 'online' && !systemStatus.ragInitialized && 'Server online - RAG system not initialized'}
          {systemStatus.status === 'online' && systemStatus.isInitializing && 'Server online - Initializing RAG system...'}
          {systemStatus.status === 'online' && systemStatus.ragInitialized && 'System ready! 🚀'}
        </div>
        {systemStatus.error && (
          <div className="status-error">
            Error: {systemStatus.error}
          </div>
        )}
        {systemStatus.status === 'online' && !systemStatus.ragInitialized && !systemStatus.isInitializing && (
          <button 
            className="initialize-btn"
            onClick={initializeRAG}
            disabled={loading.initializing}
          >
            {loading.initializing ? 'Initializing...' : 'Initialize RAG System'}
          </button>
        )}
      </div>

      <div className="chat-container">
        {/* Before RAG Section */}
        <div className="chat-section before-rag">
          <h3>💭 Without RAG</h3>
          <p>Ask the AI about any topic using only its training data</p>
          <div className="input-group">
            <input
              type="text"
              value={beforeRagInput}
              onChange={(e) => setBeforeRagInput(e.target.value)}
              onKeyPress={(e) => handleKeyPress(e, chatBeforeRAG)}
              placeholder="e.g., What is Ollama?"
              disabled={systemStatus.status !== 'online' || !systemStatus.ragInitialized}
            />
            <button 
              onClick={chatBeforeRAG}
              disabled={loading.beforeRag || systemStatus.status !== 'online' || !systemStatus.ragInitialized}
              className="chat-btn"
            >
              {loading.beforeRag ? '🤔 Thinking...' : '💬 Ask'}
            </button>
          </div>
          
          {responses.beforeRag && (
            <div className="response-card">
              <h4>Response:</h4>
              {responses.beforeRag.error ? (
                <div className="error">{responses.beforeRag.error}</div>
              ) : (
                <div className="response">{responses.beforeRag.response}</div>
              )}
            </div>
          )}
        </div>

        {/* With RAG Section */}
        <div className="chat-section with-rag">
          <h3>🧠 With RAG</h3>
          <p>Ask questions that will be answered using retrieved documents</p>
          <div className="input-group">
            <input
              type="text"
              value={withRagInput}
              onChange={(e) => setWithRagInput(e.target.value)}
              onKeyPress={(e) => handleKeyPress(e, chatWithRAG)}
              placeholder="e.g., What is Ollama?"
              disabled={systemStatus.status !== 'online' || !systemStatus.ragInitialized}
            />
            <button 
              onClick={chatWithRAG}
              disabled={loading.withRag || systemStatus.status !== 'online' || !systemStatus.ragInitialized}
              className="chat-btn"
            >
              {loading.withRag ? '🔍 Searching...' : '🔍 Ask'}
            </button>
          </div>
          
          {responses.withRag && (
            <div className="response-card">
              <h4>Response:</h4>
              {responses.withRag.error ? (
                <div className="error">{responses.withRag.error}</div>
              ) : (
                <div className="response">{responses.withRag.response}</div>
              )}
            </div>
          )}
        </div>
      </div>

      <footer className="App-footer">
        <p>Make sure Ollama and Neo4j are running locally</p>
        <p>Backend: <code>http://localhost:5000</code> | Frontend: <code>http://localhost:3000</code></p>
      </footer>
    </div>
  );
}

export default App;