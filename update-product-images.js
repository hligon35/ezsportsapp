const fs = require('fs');
const path = require('path');

// Read the product list
const prodListPath = './assets/prodList.json';
const prodData = JSON.parse(fs.readFileSync(prodListPath, 'utf8'));

// Extract all products from all categories
let allProducts = [];
if (prodData.categories) {
  Object.keys(prodData.categories).forEach(categoryName => {
    const categoryProducts = prodData.categories[categoryName];
    if (Array.isArray(categoryProducts)) {
      allProducts = allProducts.concat(categoryProducts);
    }
  });
}

console.log(`Loaded ${allProducts.length} products from ${prodListPath}`);

// Show first few products as sample
console.log('Sample SKUs:');
for (let i = 0; i < Math.min(10, allProducts.length); i++) {
  console.log(`  ${i}: "${allProducts[i].sku}"`);
}

// Define the image directory mappings
const imageDirectoryMappings = {
  // Bullet L-Screens mappings (handle both PK- and RN- and standalone versions)
  'BULLETL': 'Bullet_L-Screens/Bullet_L_Screens_Baseball',
  'PK-BULLETL': 'Bullet_L-Screens/Bullet_L_Screens_Baseball',
  'RN-BULLETL': 'Bullet_L-Screens/Bullet_Replacement_Screen',
  
  'BULLETJR': 'Bullet_L-Screens/Bullet_L_Screen_JR',
  'PK-BULLETJR': 'Bullet_L-Screens/Bullet_L_Screen_JR',
  'RN-BULLETJR': 'Bullet_L-Screens/Bullet_Replacement_Screen',
  'BULLETJRBB': 'Bullet_L-Screens/Bullet_L_Screen_JR',
  
  'BULLETFT': 'Bullet_L-Screens/Bullet_Front_Toss_L_Screen(7x5)',
  'PK-BULLETFT': 'Bullet_L-Screens/Bullet_Front_Toss_L_Screen(7x5)',
  'RN-BULLETFT': 'Bullet_L-Screens/Bullet_Replacement_Screen',
  
  'BULLETCOMBO': 'Bullet_L-Screens/Bullet_L_Screen_Combo',
  'PK-BULLETCOMBO': 'Bullet_L-Screens/Bullet_L_Screen_Combo',
  'RN-BULLETCOMBO': 'Bullet_L-Screens/Bullet_Replacement_Screen',
  
  'BULLETCOP': 'Bullet_L-Screens/Bullet_L_Screen_Combo_Overhead',
  'PK-BULLETCOP': 'Bullet_L-Screens/Bullet_L_Screen_Combo_Overhead',
  'RN-BULLETCOP': 'Bullet_L-Screens/Bullet_Replacement_Screen',
  
  'BULLETLOP': 'Bullet_L-Screens/Bullet_L_Screen_Overhead',
  'PK-BULLETLOP': 'Bullet_L-Screens/Bullet_L_Screen_Overhead',
  'RN-BULLETLOP': 'Bullet_L-Screens/Bullet_Replacement_Screen',
  'BULLETOH': 'Bullet_L-Screens/Bullet_L_Screen_Overhead',
  
  'BULLETFP': 'Bullet_L-Screens/Bullet_Fast_Pitch_Screen(7x7)',
  'PK-BULLETFP': 'Bullet_L-Screens/Bullet_Fast_Pitch_Screen(7x7)',
  'RN-BULLETFP': 'Bullet_L-Screens/Bullet_Replacement_Screen',
  
  'BULLETFPOH': 'Bullet_L-Screens/Bullet_Fast_Pitch_Screen_Overhead',
  'PK-BULLETFPOH': 'Bullet_L-Screens/Bullet_Fast_Pitch_Screen_Overhead',
  'RN-BULLETFPOH': 'Bullet_L-Screens/Bullet_Replacement_Screen',
  
  'BULLETSC': 'Bullet_L-Screens/Bullet_Screen_Combo(7x7)',
  'BULLETREP': 'Bullet_L-Screens/Bullet_Replacement_Screen',
  'BULLETSOCK': 'Bullet_L-Screens/Bullet_Sock_Net_Screen(7x7)',
  
  // Sock Net Screen mappings
  'SOCKNET7X7': 'Bullet_L-Screens/Bullet_Sock_Net_Screen(7x7)',
  'PK-7X7 SOCKNET': 'Bullet_L-Screens/Bullet_Sock_Net_Screen(7x7)',
  'RN-7X7 SOCKNET': 'Bullet_L-Screens/Bullet_Replacement_Screen',
  
  // Pitcher's Pockets mappings
  'PITCHERSPOCKET9': 'Pitcher_Pockets/Pitcher\'s_Pocket',
  'PPPRO': 'Pitcher_Pockets/Pitcher\'s_Pocket_Pro',
  'BBPP-PRO': 'Pitcher_Pockets/Pitcher\'s_Pocket_Pro',
  
  // Protective Screens mappings (handle space in SKU names)
  'PROTECTIVE7X7': 'Protective_Screens/7x7_Protective_Screen',
  'PK-7X7 PROTECTIVE': 'Protective_Screens/7x7_Protective_Screen',
  'RN-7X7 PROTECTIVE': 'Protective_Screens/7x7_Protective_Screen',
  
  'PROTECTIVE8X8': 'Protective_Screens/8x8_Protective_Screen',
  'PK-8X8 PROTECTIVE': 'Protective_Screens/8x8_Protective_Screen', 
  'RN-8X8 PROTECTIVE': 'Protective_Screens/8x8_Protective_Screen',
  
  'PROTECTIVE10X10': 'Protective_Screens/10x10_Protective_Screen',
  'PK-10X10 PROTECTIVE': 'Protective_Screens/10x10_Protective_Screen',
  'RN-10X10 PROTECTIVE': 'Protective_Screens/10x10_Protective_Screen'
};
  'RN-BULLETFP': 'Bullet_L-Screens/Bullet_Replacement_Screen',
  
  'BULLETFPOH': 'Bullet_L-Screens/Bullet_Fast_Pitch_Screen_Overhead',
  'RN-BULLETFPOH': 'Bullet_L-Screens/Bullet_Replacement_Screen',
  
  'BULLETSC': 'Bullet_L-Screens/Bullet_Screen_Combo(7x7)',
  'BULLETREP': 'Bullet_L-Screens/Bullet_Replacement_Screen',
  'BULLETSOCK': 'Bullet_L-Screens/Bullet_Sock_Net_Screen(7x7)',
  
  // Pitcher's Pockets mappings
  'PITCHERSPOCKET9': 'Pitcher_Pockets/Pitcher\'s_Pocket',
  'PPPRO': 'Pitcher_Pockets/Pitcher\'s_Pocket_Pro',
  
  // Protective Screens mappings (handle space in SKU names)
  'PROTECTIVE7X7': 'Protective_Screens/7x7_Protective_Screen',
  'PK-7X7 PROTECTIVE': 'Protective_Screens/7x7_Protective_Screen',
  'RN-7X7 PROTECTIVE': 'Protective_Screens/Bullet_Replacement_Screen',
  
  'PROTECTIVE8X8': 'Protective_Screens/8x8_Protective_Screen',
  'PK-8X8 PROTECTIVE': 'Protective_Screens/8x8_Protective_Screen', 
  'RN-8X8 PROTECTIVE': 'Protective_Screens/Bullet_Replacement_Screen',
  
  'PROTECTIVE10X10': 'Protective_Screens/10x10_Protective_Screen',
  'PK-10X10 PROTECTIVE': 'Protective_Screens/10x10_Protective_Screen',
  'RN-10X10 PROTECTIVE': 'Protective_Screens/Bullet_Replacement_Screen'
};

// Function to find the best matching image file
function findBestImageMatch(directoryPath, sku) {
  try {
    const fullPath = path.join('./assets/prodImgs', directoryPath);
    const files = fs.readdirSync(fullPath);
    
    // Filter for .avif files
    const avifFiles = files.filter(file => file.endsWith('.avif'));
    
    if (avifFiles.length === 0) {
      console.log(`No AVIF files found in ${directoryPath}`);
      return null;
    }
    
    // For color variations, prefer black as default, then first available
    const blackFile = avifFiles.find(file => file.includes('black') && !file.includes('_a'));
    if (blackFile) {
      return `assets/prodImgs/${directoryPath}/${blackFile}`;
    }
    
    // For PP Pro, look for main file
    if (sku === 'PPPRO') {
      const mainFile = avifFiles.find(file => file === 'pppro.avif');
      if (mainFile) {
        return `assets/prodImgs/${directoryPath}/${mainFile}`;
      }
    }
    
    // For protective screens, look for main numbered files first
    if (sku.startsWith('PROTECTIVE')) {
      const mainFile = avifFiles.find(file => file.includes('_1.avif') && !file.includes('(1)'));
      if (mainFile) {
        return `assets/prodImgs/${directoryPath}/${mainFile}`;
      }
    }
    
    // Otherwise, take the first non-alternate (_a) file
    const mainFile = avifFiles.find(file => !file.includes('_a') && !file.includes('(1)'));
    if (mainFile) {
      return `assets/prodImgs/${directoryPath}/${mainFile}`;
    }
    
    // Fallback to first file
    return `assets/prodImgs/${directoryPath}/${avifFiles[0]}`;
    
  } catch (error) {
    console.log(`Error reading directory ${directoryPath}: ${error.message}`);
    return null;
  }
}

// Track updates
const updates = [];
let updatedCount = 0;

// Process each product
for (let i = 0; i < allProducts.length; i++) {
  const product = allProducts[i];
  const sku = product.sku;
  
  // Debug: show SKU being checked
  if (sku.includes('BULLET') || sku.includes('POCKET') || sku.includes('PROTECTIVE')) {
    console.log(`Checking SKU: "${sku}"`);
  }
  
  // Check if this SKU has a direct mapping
  if (imageDirectoryMappings[sku]) {
    console.log(`Found mapping for ${sku}`);
    const directoryPath = imageDirectoryMappings[sku];
    const newImagePath = findBestImageMatch(directoryPath, sku);
    
    if (newImagePath) {
      const oldImagePath = product.img;
      product.img = newImagePath;
      
      updates.push({
        sku: sku,
        name: product.name,
        oldImage: oldImagePath,
        newImage: newImagePath
      });
      
      updatedCount++;
      console.log(`✓ ${sku} (${product.name}) -> ${newImagePath}`);
    } else {
      console.log(`✗ ${sku} - No suitable image found in ${directoryPath}`);
    }
  }
}

// Write the updated product list back to file only if there were changes
if (updatedCount > 0) {
  try {
    fs.writeFileSync(prodListPath, JSON.stringify(prodData, null, 2));
    console.log(`Successfully wrote ${updatedCount} updates to ${prodListPath}`);
  } catch (error) {
    console.error(`Error writing file: ${error.message}`);
  }
} else {
  console.log('No changes made, skipping file write.');
}

// Generate summary report
console.log('\n=== UPDATE SUMMARY ===');
console.log(`Total products updated: ${updatedCount}`);
console.log('\nDetailed changes:');
updates.forEach(update => {
  console.log(`${update.sku}: ${update.oldImage} -> ${update.newImage}`);
});

console.log('\n=== SCRIPT COMPLETED ===');