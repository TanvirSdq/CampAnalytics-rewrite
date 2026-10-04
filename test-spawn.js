const { spawn } = require('child_process');
const cp = spawn('npx', ['tsx', '-e', 'setInterval(() => console.log("running"), 1000)'], { stdio: 'pipe' });
cp.stdout.on('data', d => console.log(d.toString().trim()));
setTimeout(() => {
  console.log('killing npx...');
  cp.kill('SIGTERM');
  setTimeout(() => {
    console.log('did it exit?');
    process.exit(0);
  }, 2000);
}, 3000);
