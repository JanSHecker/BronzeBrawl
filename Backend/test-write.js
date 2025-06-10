const fs = require('fs');
const path = require('path');

// Get absolute path to the file
const filePath = path.resolve(__dirname, 'lolInput.json');
console.log('Attempting to write to:', filePath);

// Test data
const testData = {
    test: "test",
    timestamp: new Date().toISOString()
};

try {
    // Check if file exists
    const exists = fs.existsSync(filePath);
    console.log('File exists:', exists);
    
    // Write the file
    fs.writeFileSync(filePath, JSON.stringify(testData, null, 2));
    console.log('File written successfully');
    
    // Verify the write
    const content = fs.readFileSync(filePath, 'utf8');
    console.log('File content:', content);
} catch (error) {
    console.error('Error:', error);
} 