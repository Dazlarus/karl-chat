# Karl Chat Setup Instructions

## Directory Structure
Your project should be organized like this:

```
karl-chat/
├── package.json                 # React app dependencies
├── src/
│   ├── App.js                   # React frontend component
│   ├── App.css                  # React styles
│   └── index.js                 # React entry point (unchanged)
├── public/                      # React public files (unchanged)
├── backend/
│   ├── server.js                # Backend Express server
│   ├── package.json             # Backend dependencies
│   └── config.js                # Configuration file
└── README.md
```

## Setup Steps

### 1. Prerequisites
Make sure you have these running:

- **Node.js** (v18 or higher)
- **Ollama** - Install from https://ollama.ai
- **Neo4j** - Install from https://neo4j.com/download/

### 2. Start Required Services

#### Start Ollama:
```bash
ollama serve
```

#### Pull required models:
```bash
ollama pull llama3.2          # or whatever model you prefer
ollama pull nomic-embed-text  # for embeddings
```

#### Start Neo4j:
- Start Neo4j Desktop or Neo4j server
- Default credentials: username=`neo4j`, password=`password`
- Make sure it's running on `bolt://localhost:7687`

### 3. Setup Backend

#### Create backend directory and files:
```bash
mkdir backend
cd backend
```

#### Create package.json in backend/:
Use the backend-package.json content I provided above.

#### Install backend dependencies:
```bash
npm install
```

#### Create config.js in backend/:
```javascript
function loadConfig() {
    return {
        OLLAMA_HOST: process.env.OLLAMA_HOST || 'localhost',
        OLLAMA_PORT: process.env.OLLAMA_PORT || '11434',
        DEFAULT_MODEL: process.env.DEFAULT_MODEL || 'llama3.2',
        NEO4J_URL: process.env.NEO4J_URL || 'bolt://localhost:7687',
        NEO4J_USERNAME: process.env.NEO4J_USERNAME || 'neo4j',
        NEO4J_PASSWORD: process.env.NEO4J_PASSWORD || 'password'
    };
}

module.exports = { loadConfig };
```

#### Create server.js in backend/:
Use the backend server code I provided above.

### 4. Setup Frontend

#### In the main project directory, update package.json:
Use the React package.json content I provided above.

#### Install React dependencies:
```bash
npm install
```

#### Update src/App.js:
Use the React App.js code I provided above.

#### Update src/App.css:
Use the React CSS code I provided above.

### 5. Running the Application

#### Terminal 1 - Start Backend:
```bash
cd backend
npm start
# or for development with auto-restart:
npm run dev
```

Backend will run on: http://localhost:5000

#### Terminal 2 - Start Frontend:
```bash
# In main project directory
npm start
```

Frontend will run on: http://localhost:3000

### 6. Verification

1. **Check Backend**: Visit http://localhost:5000/api/health
   - Should return JSON with system status

2. **Check Frontend**: Visit http://localhost:3000
   - Should show the Karl Chat interface
   - Status should show "System ready! 🚀"

3. **Test Chat**: 
   - Try asking "What is Ollama?" in both sections
   - Compare responses with and without RAG

## Troubleshooting

### Common Issues:

#### "Cannot connect to Ollama"
- Make sure Ollama is running: `ollama serve`
- Check if your model is available: `ollama list`
- Verify the model name in config.js matches your available models

#### "Cannot connect to Neo4j"
- Start Neo4j service
- Check username/password in config.js
- Default: username=`neo4j`, password=`password`

#### "System offline" status
- Make sure backend server is running on port 5000
- Check backend terminal for error messages

#### CORS errors
- Backend includes CORS middleware for localhost:3000
- Make sure frontend is running on port 3000

### Port Configuration:
- Frontend: http://localhost:3000 (React default)
- Backend: http://localhost:5000 (configured in server.js)
- Ollama: http://localhost:11434 (Ollama default)
- Neo4j: bolt://localhost:7687 (Neo4j default)

## Environment Variables (Optional)

Create a `.env` file in the backend directory:

```env
OLLAMA_HOST=localhost
OLLAMA_PORT=11434
DEFAULT_MODEL=llama3.2
NEO4J_URL=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=password
```

## Development Scripts

From main directory:
- `npm start` - Start React frontend
- `npm run start-backend` - Start backend from main directory
- `npm run dev-backend` - Start backend in development mode

From backend directory:
- `npm start` - Start backend server
- `npm run dev` - Start backend with nodemon (auto-restart)
