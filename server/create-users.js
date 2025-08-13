const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('crypto');

// Generate UUID
function generateId() {
    return 'user_' + Math.random().toString(36).substr(2, 9);
}

async function createUsers() {
    console.log('Creating users...');
    
    // Hash passwords
    const adminPassword = await bcrypt.hash('admin123', 10);
    const demoPassword = await bcrypt.hash('demo123', 10);
    
    // Create user objects
    const users = [
        {
            id: generateId(),
            email: 'admin@ezsports.com',
            password: adminPassword,
            firstName: 'Admin',
            lastName: 'User',
            role: 'admin',
            createdAt: new Date().toISOString()
        },
        {
            id: generateId(),
            email: 'demo@user.com',
            password: demoPassword,
            firstName: 'Demo',
            lastName: 'User',
            role: 'user',
            createdAt: new Date().toISOString()
        }
    ];
    
    // Write to users.json
    const usersPath = path.join(__dirname, 'database', 'users.json');
    await fs.promises.writeFile(usersPath, JSON.stringify(users, null, 2));
    
    console.log('Users created successfully!');
    console.log('Login credentials:');
    console.log('Admin: admin@ezsports.com / admin123');
    console.log('Demo: demo@user.com / demo123');
}

createUsers().catch(console.error);
