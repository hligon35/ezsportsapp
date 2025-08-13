// Database management utilities
const DatabaseManager = require('./database/DatabaseManager');
const path = require('path');

const db = new DatabaseManager();

const commands = {
  backup: async () => {
    try {
      const backupPath = await db.backup();
      console.log(`✅ Database backed up successfully to: ${backupPath}`);
    } catch (error) {
      console.error('❌ Backup failed:', error.message);
    }
  },

  stats: async () => {
    try {
      const users = await db.find('users');
      const products = await db.find('products');
      const orders = await db.find('orders');
      const schema = await db.read('schema');

      console.log('\n📊 Database Statistics:');
      console.log(`Users: ${users.length}`);
      console.log(`Products: ${products.length}`);
      console.log(`Orders: ${orders.length}`);
      console.log(`Database Version: ${schema.metadata?.version || 'Unknown'}`);
      console.log(`Last Modified: ${schema.metadata?.lastModified || 'Unknown'}`);
      
      // Product categories breakdown
      const categories = products.reduce((acc, p) => {
        acc[p.category] = (acc[p.category] || 0) + 1;
        return acc;
      }, {});
      
      console.log('\n📦 Products by Category:');
      Object.entries(categories).forEach(([cat, count]) => {
        console.log(`  ${cat}: ${count}`);
      });

      // Order status breakdown
      const orderStatuses = orders.reduce((acc, o) => {
        acc[o.status] = (acc[o.status] || 0) + 1;
        return acc;
      }, {});
      
      if (orders.length > 0) {
        console.log('\n📋 Orders by Status:');
        Object.entries(orderStatuses).forEach(([status, count]) => {
          console.log(`  ${status}: ${count}`);
        });
        
        const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
        console.log(`\n💰 Total Revenue: $${totalRevenue.toFixed(2)}`);
      }

    } catch (error) {
      console.error('❌ Failed to get stats:', error.message);
    }
  },

  reset: async () => {
    try {
      console.log('⚠️  Resetting database...');
      
      // Clear all data
      await db.write('users', []);
      await db.write('products', []);
      await db.write('orders', []);
      
      // Reset auto-increment counters
      const schema = await db.read('schema');
      schema.metadata.autoIncrement = {
        users: 1000,
        products: 2000,
        orders: 3000
      };
      await db.write('schema', schema);
      
      console.log('✅ Database reset complete');
    } catch (error) {
      console.error('❌ Reset failed:', error.message);
    }
  },

  help: () => {
    console.log(`
🗄️  Database Management Utilities

Available commands:
  backup  - Create a backup of the database
  stats   - Show database statistics
  reset   - Reset database (clears all data)
  help    - Show this help message

Usage: node db-utils.js <command>
Example: node db-utils.js backup
`);
  }
};

async function main() {
  const command = process.argv[2];
  
  if (!command || !commands[command]) {
    commands.help();
    return;
  }
  
  await commands[command]();
}

main().catch(console.error);
