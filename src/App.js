const express = require('express');
const cors = require('cors');
const path = require('path');
const { WebBaseLoader } = require('langchain/document_loaders/web/web_base');
const { Neo4jVectorStore } = require('@langchain/community/vectorstores/neo4j');
const { ChatOllama } = require('langchain/chat_models/ollama');
const { OllamaEmbeddings } = require('@langchain/ollama');
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');
const { ChatPromptTemplate } = require('langchain/prompts');
const { StringOutputParser } = require('langchain/schema/output_parser');
const { RunnableSequence, RunnablePassthrough } = require('langchain/schema/runnable');
const config = require('./config');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Load configuration
const appConfig = config.loadConfig();
const OLLAMA_HOST = appConfig.OLLAMA_HOST;
const OLLAMA_PORT = appConfig.OLLAMA_PORT;
const DEFAULT_MODEL = appConfig.DEFAULT_MODEL;

// Initialize components
let vectorstore = null;
let retriever = null;
let chatModel = null;

// Initialize the RAG system
async function initializeRAG() {
    try {
        console.log('Initializing RAG system...');
        
        // Initialize chat model
        chatModel = new ChatOllama({
            baseUrl: `http://${OLLAMA_HOST}:${OLLAMA_PORT}`,
            model: DEFAULT_MODEL,
        });

        // Initialize embeddings
        const embeddings = new OllamaEmbeddings({
            baseUrl: `http://${OLLAMA_HOST}:${OLLAMA_PORT}`,
            model: 'nomic-embed-text',
        });

        // Default URLs (can be made configurable)
        const urls = [
            "https://ollama.com",
            "https://ollama.com/blog/windows-preview",
            "https://ollama.com/blog/openai-compatibility",
        ];

        // Load and process documents
        const docs = [];
        for (const url of urls) {
            try {
                const loader = new WebBaseLoader(url);
                const loadedDocs = await loader.load();
                docs.push(...loadedDocs);
            } catch (error) {
                console.error(`Error loading ${url}:`, error.message);
            }
        }

        if (docs.length === 0) {
            throw new Error('No documents were successfully loaded');
        }

        // Split documents
        const textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 7500,
            chunkOverlap: 100,
        });

        const docSplits = await textSplitter.splitDocuments(docs);
        console.log(`Split documents into ${docSplits.length} chunks`);

        // Create vector store
        vectorstore = await Neo4jVectorStore.fromDocuments(docSplits, embeddings, {
            url: "bolt://localhost:7687",
            username: "neo4j",
            password: "password",
        });

        retriever = vectorstore.asRetriever();
        console.log('RAG system initialized successfully');
        
    } catch (error) {
        console.error('Error initializing RAG system:', error);
        throw error;
    }
}

// Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        ragInitialized: vectorstore !== null,
        timestamp: new Date().toISOString()
    });
});

// Chat endpoint - before RAG
app.post('/api/chat/before-rag', async (req, res) => {
    try {
        const { topic } = req.body;
        
        if (!topic) {
            return res.status(400).json({ error: 'Topic is required' });
        }

        if (!chatModel) {
            return res.status(503).json({ error: 'Chat model not initialized' });
        }

        const prompt = ChatPromptTemplate.fromTemplate(
            "What is {topic} in under 100 words?"
        );

        const chain = RunnableSequence.from([
            prompt,
            chatModel,
            new StringOutputParser(),
        ]);

        const response = await chain.invoke({ topic });
        
        res.json({ 
            response,
            method: 'before-rag',
            topic 
        });

    } catch (error) {
        console.error('Error in before-rag chat:', error);
        res.status(500).json({ error: 'Internal server error' });
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
            return res.status(503).json({ error: 'RAG system not initialized' });
        }

        const prompt = ChatPromptTemplate.fromTemplate(
            `Answer the question based only on the following context in under 100 words:
{context}

Question: {question}`
        );

        const chain = RunnableSequence.from([
            {
                context: async (input) => {
                    const docs = await retriever.getRelevantDocuments(input.question);
                    return docs.map(doc => doc.pageContent).join('\n\n');
                },
                question: new RunnablePassthrough(),
            },
            prompt,
            chatModel,
            new StringOutputParser(),
        ]);

        const response = await chain.invoke({ question });
        
        res.json({ 
            response,
            method: 'with-rag',
            question 
        });

    } catch (error) {
        console.error('Error in RAG chat:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add new URLs to vector store
app.post('/api/add-urls', async (req, res) => {
    try {
        const { urls } = req.body;
        
        if (!urls || !Array.isArray(urls)) {
            return res.status(400).json({ error: 'URLs array is required' });
        }

        if (!vectorstore) {
            return res.status(503).json({ error: 'Vector store not initialized' });
        }

        const docs = [];
        const errors = [];

        for (const url of urls) {
            try {
                const loader = new WebBaseLoader(url);
                const loadedDocs = await loader.load();
                docs.push(...loadedDocs);
            } catch (error) {
                errors.push({ url, error: error.message });
            }
        }

        if (docs.length > 0) {
            const textSplitter = new RecursiveCharacterTextSplitter({
                chunkSize: 7500,
                chunkOverlap: 100,
            });

            const docSplits = await textSplitter.splitDocuments(docs);
            await vectorstore.addDocuments(docSplits);
        }

        res.json({ 
            success: true,
            documentsAdded: docs.length,
            errors 
        });

    } catch (error) {
        console.error('Error adding URLs:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Serve the frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function startServer() {
    try {
        // Initialize RAG system first
        await initializeRAG();
        
        app.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
            console.log('RAG system ready for queries');
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    if (vectorstore) {
        await vectorstore.close();
    }
    process.exit(0);
});

// Start the application
startServer();