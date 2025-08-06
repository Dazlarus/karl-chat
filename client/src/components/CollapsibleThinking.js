import React, { useState } from 'react';

const CollapsibleThinking = ({ thinking, response, title, error }) => {
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);

  const thinkingWordCount = thinking ? thinking.split(' ').length : 0;

  if (error) {
    return (
      <div className="response-card">
        <h4>{title}</h4>
        <div className="error">{error}</div>
      </div>
    );
  }

  return (
    <div className="response-card">
      <h4>{title}</h4>
      
      {/* Collapsible Thinking Section */}
      {thinking && (
        <div className="thinking-container">
          <button
            onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
            className={`thinking-header ${isThinkingExpanded ? 'expanded' : ''}`}
          >
            <div className="thinking-title">
              <span className="thinking-icon">🧠</span>
              <span className="thinking-label">Thinking Process</span>
              <span className="thinking-word-count">
                {thinkingWordCount} words
              </span>
            </div>
            <span className={`thinking-chevron ${isThinkingExpanded ? 'expanded' : ''}`}>
              ▼
            </span>
          </button>
          
          <div className={`thinking-content ${isThinkingExpanded ? 'expanded' : ''}`}>
            <div className="thinking-content-inner">
              <pre className="thinking-text">
                {thinking}
              </pre>
            </div>
          </div>
        </div>
      )}
      
      {/* Main Response */}
      <div className="response">
        {response}
      </div>
    </div>
  );
};

export default CollapsibleThinking;