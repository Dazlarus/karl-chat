// backend/utils/neo4j-utils.js - Utilities for Neo4j integration
const neo4j = require('neo4j-driver');

class Neo4jUtils {
    /**
     * Clean document metadata for Neo4j compatibility
     * Neo4j can only store primitive types as node properties
     */
    static cleanDocumentMetadata(documents) {
        return documents.map((doc, index) => {
            const cleanedMetadata = {};
            
            // Process each metadata field
            Object.entries(doc.metadata || {}).forEach(([key, value]) => {
                // Only store primitive types directly
                if (this.isPrimitiveType(value)) {
                    cleanedMetadata[key] = value;
                } else if (value !== null && value !== undefined) {
                    // Convert complex objects to JSON strings
                    try {
                        cleanedMetadata[key] = JSON.stringify(value);
                    } catch (error) {
                        console.warn(`⚠️ Could not serialize metadata field '${key}':`, error.message);
                        cleanedMetadata[key] = String(value);
                    }
                }
            });
            
            // Ensure essential metadata fields exist
            cleanedMetadata.source = cleanedMetadata.source || 'unknown';
            cleanedMetadata.chunk_id = cleanedMetadata.chunk_id || `chunk_${index}_${Date.now()}`;
            cleanedMetadata.created_at = new Date().toISOString();
            cleanedMetadata.content_length = doc.pageContent.length;
            
            return {
                pageContent: doc.pageContent,
                metadata: cleanedMetadata
            };
        });
    }
    
    /**
     * Check if a value is a primitive type that Neo4j can store
     */
    static isPrimitiveType(value) {
        const type = typeof value;
        return type === 'string' || 
               type === 'number' || 
               type === 'boolean' || 
               value === null || 
               value === undefined ||
               (Array.isArray(value) && value.every(item => this.isPrimitiveType(item)));
    }
    
    /**
     * Test Neo4j connection
     */
    static async testConnection(uri, username, password) {
        const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
        
        try {
            const session = driver.session();
            await session.run('RETURN 1');
            await session.close();
            return { success: true, message: 'Connection successful' };
        } catch (error) {
            return { 
                success: false, 
                error: error.message,
                code: error.code 
            };
        } finally {
            await driver.close();
        }
    }
    
    /**
     * Clean up existing vector index if needed
     */
    static async cleanupVectorStore(uri, username, password, indexName = 'vector_index') {
        const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
        
        try {
            const session = driver.session();
            
            // Drop existing vector index if it exists
            try {
                await session.run(`DROP INDEX ${indexName} IF EXISTS`);
                console.log(`🗑️ Dropped existing vector index: ${indexName}`);
            } catch (error) {
                // Index might not exist, that's okay
                console.log(`📝 Vector index ${indexName} did not exist or could not be dropped`);
            }
            
            // Clean up document nodes if needed
            const result = await session.run(`
                MATCH (n:Document) 
                RETURN count(n) as nodeCount
            `);
            
            const nodeCount = result.records[0]?.get('nodeCount')?.toNumber() || 0;
            if (nodeCount > 0) {
                console.log(`🧹 Found ${nodeCount} existing document nodes`);
                
                // Optionally clean up (be careful in production!)
                // await session.run('MATCH (n:Document) DETACH DELETE n');
                // console.log('🗑️ Cleaned up existing document nodes');
            }
            
            await session.close();
        } catch (error) {
            console.error('❌ Error during cleanup:', error.message);
            throw error;
        } finally {
            await driver.close();
        }
    }
    
    /**
     * Get Neo4j database info
     */
    static async getDatabaseInfo(uri, username, password) {
        const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
        
        try {
            const session = driver.session();
            
            // Get Neo4j version
            const versionResult = await session.run('CALL dbms.components() YIELD name, versions RETURN name, versions');
            
            // Get database statistics
            const statsResult = await session.run(`
                CALL apoc.meta.stats() YIELD labels, relTypesCount, propertyKeyCount, nodeCount, relCount
                RETURN labels, relTypesCount, propertyKeyCount, nodeCount, relCount
            `);
            
            await session.close();
            
            return {
                version: versionResult.records[0]?.get('versions')?.[0] || 'unknown',
                stats: statsResult.records[0] ? {
                    nodeCount: statsResult.records[0].get('nodeCount')?.toNumber() || 0,
                    relationshipCount: statsResult.records[0].get('relCount')?.toNumber() || 0,
                    labels: statsResult.records[0].get('labels') || {},
                    propertyKeys: statsResult.records[0].get('propertyKeyCount')?.toNumber() || 0
                } : null
            };
        } catch (error) {
            console.warn('⚠️ Could not get database info (this is normal if APOC is not installed):', error.message);
            return { version: 'unknown', stats: null };
        } finally {
            await driver.close();
        }
    }
}

module.exports = Neo4jUtils;