// Database initialization script
const DatabaseManager = require('./database/DatabaseManager');
const ProductService = require('./services/ProductService');
const UserService = require('./services/UserService');

async function initializeDatabase() {
  console.log('Initializing database...');
  
  try {
    const db = new DatabaseManager();
    const productService = new ProductService();
    const userService = new UserService();
    
    // Initialize database structure
    await db.initialize();
    
    // Check if we already have data
    const existingProducts = await productService.getAllProducts(true);
    const existingUsers = await userService.getAllUsers();
    
    console.log(`Found ${existingProducts.length} products and ${existingUsers.length} users`);
    
    // Create admin user if it doesn't exist
    const adminExists = existingUsers.find(u => u.email === 'admin@ezsports.com');
    if (!adminExists) {
      console.log('Creating admin user...');
      await userService.register({
        email: 'admin@ezsports.com',
        password: 'admin123',
        name: 'Admin User'
      });
      console.log('Admin user created: admin@ezsports.com / admin123');
    } else {
      console.log('Admin user already exists');
    }
    
    // Create demo user if it doesn't exist
    const demoExists = existingUsers.find(u => u.email === 'demo@user.com');
    if (!demoExists) {
      console.log('Creating demo user...');
      await userService.register({
        email: 'demo@user.com',
        password: 'demo123',
        name: 'Demo User'
      });
      console.log('Demo user created: demo@user.com / demo123');
    } else {
      console.log('Demo user already exists');
    }
    
    console.log('Database initialization complete!');
    console.log('\nLogin credentials:');
    console.log('Admin: admin@ezsports.com / admin123');
    console.log('Demo User: demo@user.com / demo123');
    
  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  initializeDatabase();
}

module.exports = initializeDatabase;
