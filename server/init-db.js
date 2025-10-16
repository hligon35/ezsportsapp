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
    // Primary admin is the owner account (email-based)
    
  // Demo user no longer seeded

    // Create owner admin user if it doesn't exist
  const ownerExists = existingUsers.find(u => (u.email||'').toLowerCase() === 'amercedes@ezsportsnetting.com' || (u.username||'').toLowerCase() === 'amercedes');
    if (!ownerExists) {
      console.log('Creating owner admin user...');
      await userService.register({
        email: 'amercedes@ezsportsnetting.com',
        username: 'amercedes',
        password: '#EZSports25',
        name: 'EZ Sports Owner',
        isAdmin: true
      });
      console.log('Owner admin created: amercedes@ezsportsnetting.com / #EZSports2025');
    } else {
      console.log('Owner admin already exists');
    }

    // Create requested test customer if it doesn't exist (username-based login)
  const customerExists = existingUsers.find(u => (u.username||'').toLowerCase() === 'customer' || (u.email||'').toLowerCase() === 'customer@ezsportsnetting.com');
    if (!customerExists) {
      console.log('Creating test customer user...');
      await userService.register({
        email: 'customer@ezsportsnetting.com',
        username: 'customer',
        password: 'custom123',
        name: 'Test Customer'
      });
      console.log('Customer user created: customer / custom123');
    } else {
      console.log('Customer user already exists');
    }
    
    console.log('Database initialization complete!');
    console.log('\nLogin credentials:');
  // Admin user (username) no longer seeded by default
  console.log('Owner (email login): amercedes@ezsportsnetting.com / #EZSports2025');
  console.log('Customer (username login): customer / custom123');
    
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
