// Database Manager - JSON-based persistent storage
const fs = require('fs').promises;
const path = require('path');

class DatabaseManager {
  constructor(dbPath = __dirname) {
    this.dbPath = path.resolve(dbPath);
    this.collections = {
      users: 'users.json',
      products: 'products.json',
      orders: 'orders.json',
      schema: 'schema.json',
  stock_movements: 'stock_movements.json',
  analytics: 'analytics.json',
  subscribers: 'subscribers.json',
  coupons: 'coupons.json',
  emails: 'emails.json',
  payouts: 'payouts.json',
  errors: 'errors.json'
    };
  }

  // Convenience: return all records in a collection
  async findAll(collection) {
    return this.read(collection);
  }

  // Read data from a collection
  async read(collection) {
    try {
      const filePath = path.join(this.dbPath, this.collections[collection]);
      const data = await fs.readFile(filePath, 'utf8');
      try {
        return JSON.parse(data);
      } catch (parseErr) {
        // Attempt a minimal repair: trim BOM/whitespace and retry; otherwise back up corrupt file
        let txt = data.replace(/^\uFEFF/, '').trim();
        try {
          const repaired = JSON.parse(txt);
          // Write back the repaired JSON to keep DB healthy
          await fs.writeFile(filePath, JSON.stringify(repaired, null, 2), 'utf8');
          return repaired;
        } catch (_) {
          const bak = filePath + ".corrupt-" + new Date().toISOString().replace(/[:.]/g,'-') + ".bak";
          await fs.writeFile(bak, data, 'utf8').catch(()=>{});
          // Start fresh for this collection
          await fs.writeFile(filePath, JSON.stringify([], null, 2), 'utf8');
          return [];
        }
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  // Write data to a collection
  async write(collection, data) {
    try {
      const filePath = path.join(this.dbPath, this.collections[collection]);
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
      
      // Update schema metadata
      await this.updateMetadata();
      return true;
    } catch (error) {
      throw error;
    }
  }

  // Update metadata with last modified time
  async updateMetadata() {
    try {
      const schema = await this.read('schema');
      if (schema && typeof schema === 'object') {
        schema.metadata = schema.metadata || {};
        schema.metadata.lastModified = new Date().toISOString();
        const filePath = path.join(this.dbPath, this.collections.schema);
        await fs.writeFile(filePath, JSON.stringify(schema, null, 2), 'utf8');
      }
    } catch (error) {
      console.error('Failed to update metadata:', error);
    }
  }

  // Get next auto-increment ID
  async getNextId(collection) {
    try {
  let schema = await this.read('schema');
  // schema.json should be an object; if it’s an array or otherwise malformed, normalize it.
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) schema = { metadata: {} };
  schema.metadata = schema.metadata || {};
  schema.metadata.autoIncrement = schema.metadata.autoIncrement || {};
  // Ensure key exists for this collection
  if (typeof schema.metadata.autoIncrement[collection] !== 'number') {
    // sensible defaults
    const defaults = { users: 1000, products: 2000, orders: 3000, analytics: 1, subscribers: 1, coupons: 1, emails: 1, payouts: 1, errors: 1 };
    schema.metadata.autoIncrement[collection] = defaults[collection] || 1;
  }
  const currentId = schema.metadata.autoIncrement[collection] || 0;
  schema.metadata.autoIncrement[collection] = currentId + 1;
  const filePath = path.join(this.dbPath, this.collections.schema);
  await fs.writeFile(filePath, JSON.stringify(schema, null, 2), 'utf8');
      return currentId + 1;
    } catch (error) {
      throw error;
    }
  }

  // Find records by criteria
  async find(collection, criteria = {}) {
    const data = await this.read(collection);
    if (Object.keys(criteria).length === 0) {
      return data;
    }
    
    return data.filter(item => {
      return Object.keys(criteria).every(key => {
        if (typeof criteria[key] === 'object' && criteria[key].$regex) {
          const regex = new RegExp(criteria[key].$regex, criteria[key].$options || '');
          return regex.test(item[key]);
        }
        return item[key] === criteria[key];
      });
    });
  }

  // Find one record by criteria
  async findOne(collection, criteria) {
    const results = await this.find(collection, criteria);
    return results.length > 0 ? results[0] : null;
  }

  // Insert a new record
  async insert(collection, data) {
    const records = await this.read(collection);
    
    // Add timestamps
    data.createdAt = new Date().toISOString();
    if (collection !== 'schema') {
      data.updatedAt = new Date().toISOString();
    }
    
    // Generate ID if not provided
    if (!data.id) {
      if (collection === 'products') {
        data.id = `prod-${await this.getNextId(collection)}`;
      } else {
        data.id = await this.getNextId(collection);
      }
    }
    
    records.push(data);
    await this.write(collection, records);
    return data;
  }

  // Update a record
  async update(collection, criteria, updateData) {
    const records = await this.read(collection);
    let updated = false;
    
    const updatedRecords = records.map(record => {
      const matches = Object.keys(criteria).every(key => record[key] === criteria[key]);
      if (matches) {
        updated = true;
        return {
          ...record,
          ...updateData,
          updatedAt: new Date().toISOString()
        };
      }
      return record;
    });
    
    if (updated) {
      await this.write(collection, updatedRecords);
    }
    
    return updated;
  }

  // Delete records
  async delete(collection, criteria) {
    const records = await this.read(collection);
    const filteredRecords = records.filter(record => {
      return !Object.keys(criteria).every(key => record[key] === criteria[key]);
    });
    
    const deletedCount = records.length - filteredRecords.length;
    
    if (deletedCount > 0) {
      await this.write(collection, filteredRecords);
    }
    
    return deletedCount;
  }

  // Initialize database with default data
  async initialize() {
    try {
      // Ensure database directory exists
      await fs.mkdir(this.dbPath, { recursive: true });
      
      // Check if files exist, create if they don't
      for (const [collection, filename] of Object.entries(this.collections)) {
        const filePath = path.join(this.dbPath, filename);
        try {
          await fs.access(filePath);
        } catch {
          // File doesn't exist, create with default data
          let defaultData = [];
          if (collection === 'schema') {
            defaultData = {
              metadata: {
                version: "1.0.0",
                created: new Date().toISOString(),
                lastModified: new Date().toISOString(),
                autoIncrement: {
                  users: 1000,
                  products: 2000,
                  orders: 3000,
                  analytics: 1,
                  subscribers: 1,
                  coupons: 1,
                  emails: 1,
                  payouts: 1,
                  errors: 1
                },
                inventoryThresholds: {
                  low: 10,
                  critical: 5
                }
              }
            };
          }
          await fs.writeFile(filePath, JSON.stringify(defaultData, null, 2), 'utf8');
        }
      }
      
      console.log('Database initialized successfully');
    } catch (error) {
      console.error('Database initialization failed:', error);
      throw error;
    }
  }

  // Backup database
  async backup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(this.dbPath, 'backups', timestamp);
    
    try {
      await fs.mkdir(backupDir, { recursive: true });
      
      for (const filename of Object.values(this.collections)) {
        const sourcePath = path.join(this.dbPath, filename);
        const backupPath = path.join(backupDir, filename);
        await fs.copyFile(sourcePath, backupPath);
      }
      
      console.log(`Database backed up to: ${backupDir}`);
      return backupDir;
    } catch (error) {
      console.error('Backup failed:', error);
      throw error;
    }
  }
}

module.exports = DatabaseManager;
