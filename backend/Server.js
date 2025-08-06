// backend/Server.js - Updated to use hierarchical configuration
const express = require('express');
const cors = require('cors');

// Updated LangChain imports for v0.3.x
const { CheerioWebBaseLoader } = require('@langchain/community/document_loaders/web/cheerio');
const { Neo4jVectorStore } = require('@langchain/community/vectorstores/neo4j_vector');
const { ChatOllama, OllamaEmbeddings } = require('@langchain/ollama');
const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');
const { ChatPromptTemplate } = require('@langchain/core/prompts');
const { StringOutputParser } = require('@langchain/core/output_parsers');
const { RunnableSequence, RunnablePassthrough } = require('@langchain/core/runnables');

// Use hierarchical configuration system
const config = require('./config');

const app = express();

// Validate configuration
try {
    config.validate();
} catch (error) {
    console.error('❌ Configuration validation failed:', error.message);
    process.exit(1);
}

// Load configuration values
const OLLAMA_HOST = config.get('OLLAMA_HOST');
const OLLAMA_PORT = config.get('OLLAMA_PORT');
const DEFAULT_MODEL = config.get('DEFAULT_MODEL');
const NEO4J_URI = config.get('NEO4J_URI');
const NEO4J_USERNAME = config.get('NEO4J_USERNAME');
const NEO4J_PASSWORD = config.get('NEO4J_PASSWORD');
const SERVER_PORT = config.get('SERVER_PORT');
const CORS_ORIGIN = config.get('CORS_ORIGIN');

// Middleware
app.use(cors({
    origin: CORS_ORIGIN,
    credentials: true
}));
app.use(express.json());

// Initialize components
let vectorstore = null;
let retriever = null;
let chatModel = null;
let isInitializing = false;
let initializationError = null;

// Initialize the RAG system
async function initializeRAG() {
    if (isInitializing) return;
    isInitializing = true;
    initializationError = null;

    try {
        console.log('🚀 Initializing RAG system...');
        
        // Initialize chat model
        chatModel = new ChatOllama({
            baseUrl: `http://${OLLAMA_HOST}:${OLLAMA_PORT}`,
            model: DEFAULT_MODEL,
            temperature: 0.7,
        });

        // Initialize embeddings
        const embeddings = new OllamaEmbeddings({
            baseUrl: `http://${OLLAMA_HOST}:${OLLAMA_PORT}`,
            model: 'nomic-embed-text',
        });

        // Test connection to Ollama
        console.log('🔌 Testing Ollama connection...');
        try {
            await chatModel.invoke('Hello');
            console.log('✅ Ollama connection successful');
        } catch (error) {
            console.error('❌ Ollama connection failed:', error.message);
            throw new Error(`Cannot connect to Ollama at ${OLLAMA_HOST}:${OLLAMA_PORT}. Make sure Ollama is running.`);
        }

        // Default URLs - these could also come from config
        const urls = config.get('DOCUMENT_URLS', [
            "https://ollama.com",
            "https://ollama.com/blog/windows-preview",
            "https://ollama.com/blog/openai-compatibility",
        ]);

        // Load and process documents
        const docs = [];
        console.log('📄 Loading documents from URLs...');
        
        for (const url of urls) {
            try {
                console.log(`Loading: ${url}`);
                const loader = new CheerioWebBaseLoader(url);
                const loadedDocs = await loader.load();
                docs.push(...loadedDocs);
                console.log(`✅ Loaded ${loadedDocs.length} documents from ${url}`);
            } catch (error) {
                console.error(`❌ Error loading ${url}:`, error.message);
            }
        }

        if (docs.length === 0) {
            throw new Error('No documents were successfully loaded from URLs');
        }

        console.log(`📚 Total documents loaded: ${docs.length}`);

        // Split documents
        const textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: config.get('CHUNK_SIZE', 1000),
            chunkOverlap: config.get('CHUNK_OVERLAP', 200),
        });

        const docSplits = await textSplitter.splitDocuments(docs);
        console.log(`✂️ Split documents into ${docSplits.length} chunks`);

        // Create vector store
        console.log('🗄️ Creating vector store...');
        
        // Clean document metadata to avoid Neo4j property issues
        const cleanedDocSplits = docSplits.map(doc => {
            // Create a new document with cleaned metadata
            const cleanedMetadata = {};
            
            // Only include primitive values in metadata
            Object.entries(doc.metadata || {}).forEach(([key, value]) => {
                if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                    cleanedMetadata[key] = value;
                } else if (value === null || value === undefined) {
                    // Skip null/undefined values
                } else {
                    // Convert complex objects to strings
                    cleanedMetadata[key] = JSON.stringify(value);
                }
            });
            
            // Ensure we have basic metadata
            cleanedMetadata.source = cleanedMetadata.source || doc.metadata?.source || 'unknown';
            cleanedMetadata.id = cleanedMetadata.id || `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            return {
                pageContent: doc.pageContent,
                metadata: cleanedMetadata
            };
        });
        
        console.log(`🧹 Cleaned metadata for ${cleanedDocSplits.length} document chunks`);
        
        try {
            vectorstore = await Neo4jVectorStore.fromDocuments(cleanedDocSplits, embeddings, {
                url: NEO4J_URI,
                username: NEO4J_USERNAME,
                password: NEO4J_PASSWORD,
                indexName: config.get('NEO4J_INDEX_NAME', 'vector_index'),
                nodeLabel: config.get('NEO4J_NODE_LABEL', 'Document'),
                textNodeProperty: config.get('NEO4J_TEXT_PROPERTY', 'text'),
                embeddingNodeProperty: config.get('NEO4J_EMBEDDING_PROPERTY', 'embedding'),
                // Add metadata handling configuration
                keywordIndexName: config.get('NEO4J_KEYWORD_INDEX', 'keyword_index'),
                searchType: 'vector',
                metadataKey: 'metadata'
            });

            retriever = vectorstore.asRetriever({
                k: config.get('RETRIEVER_K', 4),
            });
            
            console.log('🎉 RAG system initialized successfully!');
        } catch (error) {
            console.error('❌ Neo4j connection failed:', error.message);
            throw new Error(`Cannot connect to Neo4j at ${NEO4J_URI}. Make sure Neo4j is running with correct credentials.`);
        }
        
    } catch (error) {
        console.error('💥 Error initializing RAG system:', error);
        initializationError = error.message;
        throw error;
    } finally {
        isInitializing = false;
    }
}

/**
 * Parse DeepSeek response format that contains thinking and main response
 * DeepSeek typically formats responses like:
 * <think>
 * thinking content here...
 * </think>
 * 
 * main response content here...
 */
function parseThinkingResponse(response) {
    // Check for <think> tags (DeepSeek format)
    const thinkRegex = /<think>([\s\S]*?)<\/think>/i;
    const thinkMatch = response.match(thinkRegex);
    
    if (thinkMatch) {
        const thinking = thinkMatch[1].trim();
        const mainResponse = response.replace(thinkRegex, '').trim();
        
        return {
            thinking,
            response: mainResponse,
            hasThinking: true
        };
    }
    
    // Check for other common thinking patterns
    // Pattern: "Let me think about this..." followed by main response
    const thinkingPatterns = [
        /^(Let me think about this[\s\S]*?)\n\n([^]*)/i,
        /^(I need to consider[\s\S]*?)\n\n([^]*)/i,
        /^(Thinking through this[\s\S]*?)\n\n([^]*)/i,
    ];
    
    for (const pattern of thinkingPatterns) {
        const match = response.match(pattern);
        if (match && match[1].length > 50) { // Only if thinking is substantial
            return {
                thinking: match[1].trim(),
                response: match[2].trim(),
                hasThinking: true
            };
        }
    }
    
    // If no thinking pattern found, return as regular response
    return {
        thinking: null,
        response: response.trim(),
        hasThinking: false
    };
}

/**
 * Create a thinking-aware prompt that encourages step-by-step reasoning
 */
function createThinkingPrompt(originalPrompt, enableThinking = true) {
    if (!enableThinking) {
        return originalPrompt;
    }
    
    return `${originalPrompt}

Think step by step and show your reasoning process. Format your response as:

<think>
[Your detailed thinking process, analysis, and reasoning steps here]
</think>

[Your final, clear answer here]`;
}

// Routes

// Health check with configuration info
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        ragInitialized: vectorstore !== null,
        ollamaConnected: chatModel !== null,
        isInitializing,
        initializationError,
        timestamp: new Date().toISOString(),
        config: {
            ollamaHost: OLLAMA_HOST,
            ollamaPort: OLLAMA_PORT,
            model: DEFAULT_MODEL,
            neo4jUri: NEO4J_URI.replace(/\/\/.*@/, '//***@'), // Hide credentials
            configSources: config.getConfigSources()
        }
    });
});

// Configuration endpoint
app.get('/api/config', (req, res) => {
    res.json({
        config: config.getSafeConfig(),
        sources: config.getConfigSources()
    });
});

// Reload configuration endpoint
app.post('/api/config/reload', (req, res) => {
    try {
        const newConfig = config.reload();
        res.json({ 
            success: true, 
            message: 'Configuration reloaded successfully',
            config: config.getSafeConfig()
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Initialize RAG endpoint
app.post('/api/initialize', async (req, res) => {
    try {
        if (vectorstore) {
            return res.json({ success: true, message: 'RAG system already initialized' });
        }
        
        await initializeRAG();
        res.json({ success: true, message: 'RAG system initialized successfully' });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: 'Check server logs for more information'
        });
    }
});

// Chat endpoint - before RAG
app.post('/api/chat/before-rag', async (req, res) => {
    try {
        const { topic, enableThinking = true } = req.body;
        
        if (!topic) {
            return res.status(400).json({ error: 'Topic is required' });
        }

        if (!chatModel) {
            return res.status(503).json({ 
                error: 'Chat model not initialized',
                needsInitialization: true
            });
        }

        console.log(`💬 Before RAG query: ${topic} (thinking: ${enableThinking})`);

        const basePrompt = config.get('BEFORE_RAG_PROMPT', "What is {topic}? Provide a comprehensive but concise explanation.");
        const promptTemplate = createThinkingPrompt(basePrompt, enableThinking);
        
        const prompt = ChatPromptTemplate.fromTemplate(promptTemplate);
        const chain = prompt.pipe(chatModel).pipe(new StringOutputParser());
        
        const rawResponse = await chain.invoke({ topic });
        const parsedResponse = parseThinkingResponse(rawResponse);
        
        console.log(`✅ Before RAG response generated (thinking: ${parsedResponse.hasThinking})`);
        
        res.json({ 
            ...parsedResponse,
            method: 'before-rag',
            topic,
            rawResponse: rawResponse // Include for debugging
        });

    } catch (error) {
        console.error('❌ Error in before-rag chat:', error);
        res.status(500).json({ error: 'Internal server error: ' + error.message });
    }
});


// Chat endpoint - with RAG
app.post('/api/chat/with-rag', async (req, res) => {
    try {
        const { question, enableThinking = true } = req.body;
        
        if (!question) {
            return res.status(400).json({ error: 'Question is required' });
        }

        if (!retriever || !chatModel) {
            return res.status(503).json({ 
                error: 'RAG system not initialized',
                needsInitialization: true
            });
        }

        console.log(`🔍 RAG query: ${question} (thinking: ${enableThinking})`);

        const basePrompt = config.get('RAG_PROMPT', 
            `Answer the question based only on the following context:

{context}

Question: {question}

Provide a comprehensive answer based on the context provided.`
        );
        
        const promptTemplate = createThinkingPrompt(basePrompt, enableThinking);
        const prompt = ChatPromptTemplate.fromTemplate(promptTemplate);

        const chain = RunnableSequence.from([
            {
                context: async (input) => {
                    const docs = await retriever.invoke(input.question);
                    console.log(`📄 Retrieved ${docs.length} relevant documents`);
                    return docs.map(doc => doc.pageContent).join('\n\n');
                },
                question: new RunnablePassthrough(),
            },
            prompt,
            chatModel,
            new StringOutputParser(),
        ]);

        const rawResponse = await chain.invoke({ question });
        const parsedResponse = parseThinkingResponse(rawResponse);
        
        console.log(`✅ RAG response generated (thinking: ${parsedResponse.hasThinking})`);
        
        res.json({ 
            ...parsedResponse,
            method: 'with-rag',
            question,
            rawResponse: rawResponse // Include for debugging
        });

    } catch (error) {
        console.error('❌ Error in RAG chat:', error);
        res.status(500).json({ error: 'Internal server error: ' + error.message });
    }
});

// Add a new endpoint to test thinking responses
app.post('/api/chat/test-thinking', async (req, res) => {
    try {
        const { prompt } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        if (!chatModel) {
            return res.status(503).json({ 
                error: 'Chat model not initialized',
                needsInitialization: true
            });
        }

        console.log(`🧪 Testing thinking response for: ${prompt}`);

        const thinkingPrompt = `${prompt}

Please think through this step by step and show your reasoning. Format your response as:

<think>
Let me analyze this question...
[Your detailed thinking process here]
</think>

[Your final answer here]`;

        const response = await chatModel.invoke(thinkingPrompt);
        const parsedResponse = parseThinkingResponse(response);
        
        console.log(`✅ Test thinking response generated (thinking: ${parsedResponse.hasThinking})`);
        
        res.json({
            ...parsedResponse,
            method: 'test-thinking',
            originalPrompt: prompt,
            rawResponse: response
        });

    } catch (error) {
        console.error('❌ Error in test thinking:', error);
        res.status(500).json({ error: 'Internal server error: ' + error.message });
    }
});

// Add endpoint to configure thinking behavior
app.post('/api/config/thinking', (req, res) => {
    try {
        const { enableByDefault, thinkingPromptSuffix } = req.body;
        
        // You could store this in your config system
        // For now, just acknowledge the settings
        
        res.json({
            success: true,
            settings: {
                enableByDefault: enableByDefault !== false,
                thinkingPromptSuffix: thinkingPromptSuffix || "Think step by step and show your reasoning."
            }
        });
        
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('💥 Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(SERVER_PORT, () => {
    console.log(`🚀 Karl Chat Backend Server running on http://localhost:${SERVER_PORT}`);
    console.log(`📡 Frontend should run on ${CORS_ORIGIN}`);
    console.log(`🔧 Configuration loaded from multiple sources:`);
    console.log(`- Ollama: ${OLLAMA_HOST}:${OLLAMA_PORT}`);
    console.log(`- Model: ${DEFAULT_MODEL}`);
    console.log(`- Neo4j: ${NEO4J_URI.replace(/\/\/.*@/, '//***@')}`);
    
    // Auto-initialize RAG system
    console.log('\n🤖 Auto-initializing RAG system...');
    initializeRAG().catch(error => {
        console.error('⚠️ Auto-initialization failed. Use /api/initialize endpoint or check configuration.');
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down backend server...');
    if (vectorstore && vectorstore.close) {
        await vectorstore.close();
    }
    process.exit(0);
});