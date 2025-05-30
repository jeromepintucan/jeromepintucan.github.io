const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');

// Read the original JavaScript file
const myJavaScriptCode = fs.readFileSync('script.js', 'utf8');

// Obfuscate the code
const obfuscatedCode = JavaScriptObfuscator.obfuscate(
  myJavaScriptCode,
  {
    compact: true,
    controlFlowFlattening: true
  }
).getObfuscatedCode();

// Save the obfuscated code to a new file
fs.writeFileSync('script-obfuscated.js', obfuscatedCode);
console.log('✅ Obfuscation complete! Check script-obfuscated.js.');