const ghpages = require('gh-pages');
const path = require('path');
const fs = require('fs');

// Copy only app files to a temp dist folder
const dist = path.join(__dirname, 'dist');
if (fs.existsSync(dist)) fs.rmSync(dist, { recursive: true });
fs.mkdirSync(dist);

// Files/folders to deploy
const items = ['index.html', 'manifest.json', 'sw.js', 'css', 'js', 'icons'];

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(child => {
      copyRecursive(path.join(src, child), path.join(dest, child));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

items.forEach(item => {
  const src = path.join(__dirname, item);
  const dest = path.join(dist, item);
  if (fs.existsSync(src)) copyRecursive(src, dest);
});

// Add .nojekyll to prevent GitHub from ignoring underscore files
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

console.log('Deploying to gh-pages...');
ghpages.publish(dist, { branch: 'gh-pages', dotfiles: true }, function(err) {
  if (err) { console.error('Deploy failed:', err); process.exit(1); }
  console.log('Deployed successfully to gh-pages branch!');
  console.log('Site: https://orameshkumar6.github.io/prj-garments/');
  // Cleanup
  fs.rmSync(dist, { recursive: true });
});
