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

const config = require('../src/config');

const app = express();
const PORT = process.env.PORT || 5000; // Different port from React (3000)

// Middleware
app.use(cors({
    origin: 'http://localhost:3000', // Allow React app
    credentials: true
}));
app.use(express.json());

// Load configuration
const appConfig = config.loadConfig();
const OLLAMA_HOST = appConfig.OLLAMA_HOST || 'localhost';
const OLLAMA_PORT = appConfig.OLLAMA_PORT || '11434';
const DEFAULT_MODEL = appConfig.DEFAULT_MODEL || 'llama3.2';

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

        // Default URLs
        const urls = [
            "https://ollama.com",
            "https://ollama.com/blog/windows-preview",
            "https://ollama.com/blog/openai-compatibility",
        ];

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
            chunkSize: 1000,
            chunkOverlap: 200,
        });

        const docSplits = await textSplitter.splitDocuments(docs);
        console.log(`✂️ Split documents into ${docSplits.length} chunks`);

        // Create vector store
        console.log('🗄️ Creating vector store...');
        try {
            vectorstore = await Neo4jVectorStore.fromDocuments(docSplits, embeddings, {
                url: "bolt://localhost:7687",
                username: "neo4j",
                password: "password",
                indexName: "vector_index",
                nodeLabel: "Document",
                textNodeProperty: "text",
                embeddingNodeProperty: "embedding",
            });

            retriever = vectorstore.asRetriever({
                k: 4,
            });
            
            console.log('🎉 RAG system initialized successfully!');
        } catch (error) {
            console.error('❌ Neo4j connection failed:', error.message);
            throw new Error(`Cannot connect to Neo4j. Make sure Neo4j is running with correct credentials.`);
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

// Health check
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
            model: DEFAULT_MODEL
        }
    });
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
            "What is {topic} in under 100 words?"
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

        const prompt = ChatPromptTemplate.fromTemplate(
            `Answer the question based only on the following context in under 100 words:

{context}

Question: {question}

Answer:`
        );

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
app.listen(PORT, () => {
    console.log(`🚀 Karl Chat Backend Server running on http://localhost:${PORT}`);
    console.log(`📡 Frontend should run on http://localhost:3000`);
    console.log(`🔧 Configuration:
- Ollama Host: ${OLLAMA_HOST}
- Ollama Port: ${OLLAMA_PORT}
- Model: ${DEFAULT_MODEL}
- Neo4j: bolt://localhost:7687`);
    
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