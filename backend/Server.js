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
        try {
            vectorstore = await Neo4jVectorStore.fromDocuments(docSplits, embeddings, {
                url: NEO4J_URI,
                username: NEO4J_USERNAME,
                password: NEO4J_PASSWORD,
                indexName: config.get('NEO4J_INDEX_NAME', 'vector_index'),
                nodeLabel: config.get('NEO4J_NODE_LABEL', 'Document'),
                textNodeProperty: config.get('NEO4J_TEXT_PROPERTY', 'text'),
                embeddingNodeProperty: config.get('NEO4J_EMBEDDING_PROPERTY', 'embedding'),
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
        const { topic } = req.body;
        
        if (!topic) {
            return res.status(400).json({ error: 'Topic is required' });
        }

        if (!chatModel) {
            return res.status(503).json({ 
                error: 'Chat model not initialized',
                needsInitialization: true
            });
        }

        console.log(`💬 Before RAG query: ${topic}`);

        const prompt = ChatPromptTemplate.fromTemplate(
            config.get('BEFORE_RAG_PROMPT', "What is {topic} in under 100 words?")
        );

        const chain = prompt.pipe(chatModel).pipe(new StringOutputParser());
        const response = await chain.invoke({ topic });
        
        console.log(`✅ Before RAG response generated`);
        
        res.json({ 
            response,
            method: 'before-rag',
            topic 
        });

    } catch (error) {
        console.error('❌ Error in before-rag chat:', error);
        res.status(500).json({ error: 'Internal server error: ' + error.message });
    }
});

// Chat endpoint - with RAG
app.post('/api/chat/with-rag', async (req, res) => {
    try {
        const { question } = req.body;
        
        if (!question) {
            return res.status(400).json({ error: 'Question is required' });
        }

        if (!retriever || !chatModel) {
            return res.status(503).json({ 
                error: 'RAG system not initialized',
                needsInitialization: true
            });
        }

        console.log(`🔍 RAG query: ${question}`);

        const promptTemplate = config.get('RAG_PROMPT', 
            `Answer the question based only on the following context in under 100 words:

{context}

Question: {question}

Answer:`
        );

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

        const response = await chain.invoke({ question });
        
        console.log(`✅ RAG response generated`);
        
        res.json({ 
            response,
            method: 'with-rag',
            question 
        });

    } catch (error) {
        console.error('❌ Error in RAG chat:', error);
        res.status(500).json({ error: 'Internal server error: ' + error.message });
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