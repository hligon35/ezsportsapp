const bcrypt = require('bcrypt');

async function generateHashes() {
    console.log('Generating password hashes...');
    
    const adminHash = await bcrypt.hash('admin123', 10);
    const demoHash = await bcrypt.hash('demo123', 10);
    
    console.log('Admin hash (admin123):', adminHash);
    console.log('Demo hash (demo123):', demoHash);
    
    // Test the hashes
    console.log('\nTesting hashes...');
    console.log('Admin123 matches:', await bcrypt.compare('admin123', adminHash));
    console.log('Demo123 matches:', await bcrypt.compare('demo123', demoHash));
}

generateHashes().catch(console.error);
