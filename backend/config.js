// backend/config.js - Configuration loader with hierarchy support
const fs = require('fs');
const path = require('path');

class ConfigLoader {
    constructor(moduleName = 'karl-chat') {
        this.moduleName = moduleName;
        this.config = {};
        this.loadConfig();
    }

    /**
     * Load configuration from multiple sources in order of precedence:
     * 1. Environment variables
     * 2. Local module config (./configs/static_settings.JSON)
     * 3. Parent directory config (../config.json, ../../config.json, etc.)
     * 4. Default values
     */
    loadConfig() {
        // Start with defaults
        this.config = this.getDefaults();

        // Load from parent directories (lowest precedence)
        this.loadParentConfigs();

        // Load local module config (higher precedence)
        this.loadLocalConfig();

        // Override with environment variables (highest precedence)
        this.loadEnvironmentConfig();

        console.log('🔧 Configuration loaded:', {
            source: this.getConfigSources(),
            config: this.getSafeConfig() // Don't log sensitive data
        });
    }

    /**
     * Default configuration values
     */
    getDefaults() {
        return {
            OLLAMA_HOST: 'localhost',
            OLLAMA_PORT: '11434',
            DEFAULT_MODEL: 'llama3.2',
            NEO4J_URI: 'bolt://localhost:7687',
            NEO4J_USERNAME: 'neo4j',
            NEO4J_PASSWORD: 'password',
            SERVER_PORT: 5000,
            CORS_ORIGIN: 'http://localhost:3000',
            LOG_LEVEL: 'info'
        };
    }

    /**
     * Load configurations from parent directories
     * Searches up the directory tree for config.json files
     */
    loadParentConfigs() {
        let currentDir = __dirname;
        const maxLevels = 5; // Prevent infinite loops
        
        for (let level = 0; level < maxLevels; level++) {
            const parentDir = path.resolve(currentDir, '..');
            if (parentDir === currentDir) break; // Reached root
            
            const configPath = path.join(parentDir, 'config.json');
            
            if (fs.existsSync(configPath)) {
                try {
                    const parentConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                    
                    // Merge parent config (lower precedence)
                    this.config = { ...this.config, ...parentConfig };
                    
                    // If there's a module-specific section, use it
                    if (parentConfig[this.moduleName]) {
                        this.config = { ...this.config, ...parentConfig[this.moduleName] };
                    }
                    
                    console.log(`📁 Loaded parent config from: ${configPath}`);
                } catch (error) {
                    console.warn(`⚠️ Error loading parent config ${configPath}:`, error.message);
                }
            }
            
            currentDir = parentDir;
        }
    }

    /**
     * Load local module configuration
     */
    loadLocalConfig() {
        const localConfigPaths = [
            path.join(__dirname, '../configs/static_settings.JSON'),
            path.join(__dirname, '../configs/config.json'),
            path.join(__dirname, '../config.json')
        ];

        for (const configPath of localConfigPaths) {
            if (fs.existsSync(configPath)) {
                try {
                    const localConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                    this.config = { ...this.config, ...localConfig };
                    console.log(`📄 Loaded local config from: ${configPath}`);
                    break; // Use first found config
                } catch (error) {
                    console.warn(`⚠️ Error loading local config ${configPath}:`, error.message);
                }
            }
        }
    }

    /**
     * Load configuration from environment variables
     */
    loadEnvironmentConfig() {
        const envMapping = {
            OLLAMA_HOST: 'OLLAMA_HOST',
            OLLAMA_PORT: 'OLLAMA_PORT',
            DEFAULT_MODEL: 'DEFAULT_MODEL',
            NEO4J_URI: 'NEO4J_URI',
            NEO4J_USERNAME: 'NEO4J_USERNAME',
            NEO4J_PASSWORD: 'NEO4J_PASSWORD',
            SERVER_PORT: 'PORT',
            CORS_ORIGIN: 'CORS_ORIGIN',
            LOG_LEVEL: 'LOG_LEVEL'
        };

        let envCount = 0;
        Object.entries(envMapping).forEach(([configKey, envKey]) => {
            if (process.env[envKey]) {
                this.config[configKey] = process.env[envKey];
                envCount++;
            }
        });

        if (envCount > 0) {
            console.log(`🌍 Loaded ${envCount} values from environment variables`);
        }
    }

    /**
     * Get configuration value with optional default
     */
    get(key, defaultValue = undefined) {
        return this.config[key] !== undefined ? this.config[key] : defaultValue;
    }

    /**
     * Get all configuration
     */
    getAll() {
        return { ...this.config };
    }

    /**
     * Get safe configuration (without sensitive data) for logging
     */
    getSafeConfig() {
        const sensitive = ['NEO4J_PASSWORD', 'API_KEY', 'SECRET'];
        const safeConfig = {};
        
        Object.entries(this.config).forEach(([key, value]) => {
            if (sensitive.some(s => key.toUpperCase().includes(s))) {
                safeConfig[key] = '***';
            } else {
                safeConfig[key] = value;
            }
        });
        
        return safeConfig;
    }

    /**
     * Get information about configuration sources
     */
    getConfigSources() {
        return {
            defaults: 'Built-in defaults',
            parent: 'Parent directory config.json files',
            local: 'Local module configs/static_settings.JSON',
            environment: 'Environment variables'
        };
    }

    /**
     * Validate required configuration
     */
    validate() {
        const required = ['OLLAMA_HOST', 'OLLAMA_PORT', 'DEFAULT_MODEL'];
        const missing = required.filter(key => !this.config[key]);
        
        if (missing.length > 0) {
            throw new Error(`Missing required configuration: ${missing.join(', ')}`);
        }
        
        return true;
    }

    /**
     * Reload configuration
     */
    reload() {
        console.log('🔄 Reloading configuration...');
        this.loadConfig();
        return this.config;
    }
}

// Export singleton instance
const configLoader = new ConfigLoader('karl-chat');
module.exports = configLoader;